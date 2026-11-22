/**
 * URL and file paths are written in the base64 alphabet (letters, digits and '/'), so a long one looks
 * like an encoded blob to block-encoding-evasion: `com/pallets/flask/issues/5000` is a 29-character run.
 * These helpers tell the two apart, so the rule can judge each part of a path on its own.
 */

/** One part of a path: letters optionally followed by digits (issues, TypeScript, v2), or digits alone (5000). */
const PATH_PART = /^(?:[A-Za-z]{1,40}[0-9]{0,12}|[0-9]{1,20})$/;

/** A run of base64-alphabet characters long enough for the rule to look at. */
const BASE64_RUN = /[A-Za-z0-9+/]{20,}={0,2}/g;

function isPrintable(byte: number): boolean {
  return (byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/**
 * True when the run, with its slashes removed, decodes as base64 to readable text. An attacker can put
 * slashes into encoded text so that every part looks like a word (aWdub3/JlIGFsbCBwcmV2/...), and the
 * slashes also stop the encoding guard from decoding it; taking them out again restores the text. Each
 * of the four base64 alignments is tried, because removing a slash that was part of the encoded data
 * shifts everything after it. Readable means 90% or more printable bytes, or 12 printable bytes in a
 * row. Measured on 20,000 generated paths, real paths decode to at most 10 printable bytes in a row.
 */
export function decodesToText(run: string): boolean {
  const joined = run.replace(/\//g, '');
  for (let offset = 0; offset < 4; offset++) {
    const bytes = Buffer.from(joined.slice(offset), 'base64');
    if (bytes.length === 0) continue;
    let printable = 0;
    let streak = 0;
    for (const byte of bytes) {
      if (isPrintable(byte)) {
        printable++;
        if (++streak >= 12) return true;
      } else {
        streak = 0;
      }
    }
    if (printable / bytes.length >= 0.9) return true;
  }
  return false;
}

/**
 * True when a run is a URL or file path rather than encoded data. It has at least two parts between
 * slashes, no '+' and no '=' padding, every part is word-shaped, and it doesn't decode to readable text
 * once its slashes are taken out. Base64 puts digits inside its parts (aWdub3Jl...), so encoded text
 * rarely even looks like a path, and the decode check catches encoded text split up to look like one.
 */
export function isPathLikeRun(run: string): boolean {
  if (!run.includes('/') || run.includes('+') || run.includes('=')) return false;
  const parts = run.split('/').filter((p) => p.length > 0);
  return parts.length >= 2 && parts.every((p) => PATH_PART.test(p)) && !decodesToText(run);
}

/**
 * The text with the slashes of every path-like run turned into spaces, so a path is judged part by part.
 * The length is unchanged, and every other character (including any real encoded blob) is left as it is.
 */
export function maskPathRuns(text: string): string {
  return text.replace(BASE64_RUN, (run) => (isPathLikeRun(run) ? run.replace(/\//g, ' ') : run));
}

/**
 * URL and file paths are written in the base64 alphabet (letters, digits and '/'), so a long one looks
 * like an encoded blob to block-encoding-evasion: `com/pallets/flask/issues/5000` is a 29-character run.
 * These helpers tell the two apart, so the rule can judge each part of a path on its own.
 */

/** One part of a path: letters optionally followed by digits (issues, TypeScript, v2), or digits alone (5000). */
const PATH_PART = /^(?:[A-Za-z]{1,40}[0-9]{0,12}|[0-9]{1,20})$/;

/** A run of base64-alphabet characters long enough for the rule to look at. */
const BASE64_RUN = /[A-Za-z0-9+/]{20,}={0,2}/g;

/**
 * True when a run is a URL or file path rather than encoded data. It has at least two parts between
 * slashes, no '+' and no '=' padding, and every part is word-shaped. Base64 puts digits inside its parts
 * (aWdub3Jl...), so encoded text practically never passes; and encoded text that is decoded to something
 * harmful is still caught by the encoding guard, which decodes and checks it separately.
 */
export function isPathLikeRun(run: string): boolean {
  if (!run.includes('/') || run.includes('+') || run.includes('=')) return false;
  const parts = run.split('/').filter((p) => p.length > 0);
  return parts.length >= 2 && parts.every((p) => PATH_PART.test(p));
}

/**
 * The text with the slashes of every path-like run turned into spaces, so a path is judged part by part.
 * The length is unchanged, and every other character (including any real encoded blob) is left as it is.
 */
export function maskPathRuns(text: string): string {
  return text.replace(BASE64_RUN, (run) => (isPathLikeRun(run) ? run.replace(/\//g, ' ') : run));
}

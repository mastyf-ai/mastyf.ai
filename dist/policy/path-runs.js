/**
 * URL and file paths are written in the base64 alphabet (letters, digits and '/'), so a long one looks
 * like an encoded blob to block-encoding-evasion: `com/pallets/flask/issues/5000` is a 29-character run.
 * These helpers tell the two apart, so the rule can judge each part of a real path on its own.
 *
 * A run is only treated as a path when all three hold:
 *  1. it sits where a path does: inside a URL, at the root of a path, or before a file extension;
 *  2. it is shaped like one: word-like parts between slashes;
 *  3. it isn't encoded text: with its slashes taken out it doesn't decode to readable text.
 * Encoded text has to beat all three at once to be let through, and the encoding guard still decodes
 * and checks whatever it can read.
 */
/** One part of a path: letters optionally followed by digits (issues, TypeScript, v2), or digits alone (5000). */
const PATH_PART = /^(?:[A-Za-z]{1,40}[0-9]{0,12}|[0-9]{1,20})$/;
/** A run of base64-alphabet characters long enough for the rule to look at. */
const BASE64_RUN = /[A-Za-z0-9+/]{20,}={0,2}/g;
/** A URL scheme (https://, file://, git+ssh://) in the text just before a run. */
const URL_SCHEME = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]*$/;
/** A file extension right after a run (.tsx, .py, .json). */
const FILE_EXTENSION = /^\.[A-Za-z0-9]{1,10}(?![A-Za-z0-9])/;
function isPrintable(byte) {
    return (byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}
function isLetterOrSpace(byte) {
    return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || byte === 0x20;
}
/**
 * True when the run, with its slashes removed, decodes as base64 to readable text. Slashes can be put
 * into encoded text so that every part looks like a word (aWdub3/JlIGFsbCBwcmV2/...), and they stop the
 * encoding guard from decoding it; taking them out restores the text. Each of the four base64 alignments
 * is tried, because removing a slash that belonged to the encoded data shifts what follows.
 *
 * Readable means, at any alignment, 90% or more printable bytes or 12 printable bytes in a row; or,
 * across the alignments together, 3 or more stretches of 6+ letters or spaces (correctly decoded
 * fragments of words, even when misalignment chops the text up). Measured: 20,000 generated paths
 * decode to at most 10 printable bytes in a row; 1,195 of 1,200 attack strings packed with up to 9
 * genuine slashes are caught by this test alone.
 */
export function decodesToText(run) {
    const joined = run.replace(/\//g, '');
    let wordStretches = 0;
    for (let offset = 0; offset < 4; offset++) {
        const bytes = Buffer.from(joined.slice(offset), 'base64');
        if (bytes.length === 0)
            continue;
        let printable = 0;
        let streak = 0;
        let letters = 0;
        for (const byte of bytes) {
            if (isPrintable(byte)) {
                printable++;
                if (++streak >= 12)
                    return true;
            }
            else {
                streak = 0;
            }
            if (isLetterOrSpace(byte)) {
                if (++letters === 6)
                    wordStretches++;
            }
            else {
                letters = 0;
            }
        }
        if (printable / bytes.length >= 0.9)
            return true;
    }
    return wordStretches >= 3;
}
/**
 * True when a run is shaped like a path and isn't encoded text: at least two parts between slashes, no
 * '+' and no '=' padding, every part word-shaped, and no readable text once the slashes are taken out.
 */
export function isPathLikeRun(run) {
    if (!run.includes('/') || run.includes('+') || run.includes('='))
        return false;
    const parts = run.split('/').filter((p) => p.length > 0);
    return parts.length >= 2 && parts.every((p) => PATH_PART.test(p)) && !decodesToText(run);
}
/**
 * True when the run sits where a path does: after a URL scheme (`https://github.com/...`: the run is
 * the domain ending and path), at the root of a path (it starts with '/': `/home/...`, `C:/Users/...`,
 * `~/...`, `./...`), or right before a file extension (`.../page.tsx`). A bare string in an argument
 * has none of these.
 */
export function isInPathPosition(text, start, run) {
    if (run.startsWith('/'))
        return true;
    if (FILE_EXTENSION.test(text.slice(start + run.length, start + run.length + 12)))
        return true;
    return URL_SCHEME.test(text.slice(Math.max(0, start - 512), start));
}
/**
 * The text with the slashes of every real path turned into spaces, so a path is judged part by part.
 * The length is unchanged, and every other character (including any encoded blob) is left as it is.
 */
export function maskPathRuns(text) {
    return text.replace(BASE64_RUN, (run, start) => isInPathPosition(text, start, run) && isPathLikeRun(run) ? run.replace(/\//g, ' ') : run);
}
//# sourceMappingURL=path-runs.js.map
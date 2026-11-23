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
export declare function decodesToText(run: string): boolean;
/**
 * True when a run is shaped like a path and isn't encoded text: at least two parts between slashes, no
 * '+' and no '=' padding, every part word-shaped, and no readable text once the slashes are taken out.
 */
export declare function isPathLikeRun(run: string): boolean;
/**
 * True when the run sits where a path does: after a URL scheme (`https://github.com/...`: the run is
 * the domain ending and path), at the root of a path (it starts with '/': `/home/...`, `C:/Users/...`,
 * `~/...`, `./...`), or right before a file extension (`.../page.tsx`). A bare string in an argument
 * has none of these.
 */
export declare function isInPathPosition(text: string, start: number, run: string): boolean;
/**
 * The text with the slashes of every real path turned into spaces, so a path is judged part by part.
 * The length is unchanged, and every other character (including any encoded blob) is left as it is.
 */
export declare function maskPathRuns(text: string): string;
//# sourceMappingURL=path-runs.d.ts.map
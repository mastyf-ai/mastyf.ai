/**
 * Enterprise evaluation bounds — payload size, regex input limits, response DLP caps.
 */
export function envInt(name, fallback) {
    const raw = process.env[name];
    if (raw == null || raw === '')
        return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
/** Max UTF-8 bytes of serialized tool arguments evaluated per request. */
export const MAX_POLICY_ARGS_BYTES = envInt('MASTYF_AI_MAX_POLICY_ARGS_BYTES', 2_097_152);
/** Max characters passed to a single RegExp.test in policy matching. */
export const MAX_REGEX_INPUT_CHARS = envInt('MASTYF_AI_MAX_REGEX_INPUT_CHARS', 65_536);
/** Max response body bytes scanned by DLP (streaming uses chunks within this cap). */
export const MAX_RESPONSE_DLP_BYTES = envInt('MASTYF_AI_MAX_RESPONSE_DLP_BYTES', 5_242_880);
/** Max compiled policy regex pattern source length. */
export const MAX_POLICY_REGEX_SOURCE_LEN = envInt('MASTYF_AI_MAX_REGEX_PATTERN_LEN', 512);
export function truncateForPolicy(text, maxChars) {
    if (text.length <= maxChars)
        return { text, truncated: false };
    return { text: text.slice(0, maxChars), truncated: true };
}
export function utf8ByteLength(text) {
    return Buffer.byteLength(text, 'utf8');
}
//# sourceMappingURL=eval-bounds.js.map
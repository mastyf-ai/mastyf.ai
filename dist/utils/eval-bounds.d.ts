/**
 * Enterprise evaluation bounds — payload size, regex input limits, response DLP caps.
 */
export declare function envInt(name: string, fallback: number): number;
/** Max UTF-8 bytes of serialized tool arguments evaluated per request. */
export declare const MAX_POLICY_ARGS_BYTES: number;
/** Max characters passed to a single RegExp.test in policy matching. */
export declare const MAX_REGEX_INPUT_CHARS: number;
/** Max response body bytes scanned by DLP (streaming uses chunks within this cap). */
export declare const MAX_RESPONSE_DLP_BYTES: number;
/** Max compiled policy regex pattern source length. */
export declare const MAX_POLICY_REGEX_SOURCE_LEN: number;
export declare function truncateForPolicy(text: string, maxChars: number): {
    text: string;
    truncated: boolean;
};
export declare function utf8ByteLength(text: string): number;
//# sourceMappingURL=eval-bounds.d.ts.map
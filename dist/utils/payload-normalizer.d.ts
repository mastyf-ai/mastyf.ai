export declare function stripZeroWidthCharacters(input: string): string;
export interface NormalizationResult {
    /** The fully normalized string ready for policy evaluation */
    normalized: string;
    /** Whether any normalization was applied */
    wasModified: boolean;
    /** What transformations were applied */
    transformations: string[];
    /** The original raw input */
    original: string;
}
/**
 * PayloadNormalizer applies multi-stage normalization to defeat
 * common evasion techniques targeting regex-based policy engines.
 */
export declare class PayloadNormalizer {
    private readonly maxDepth;
    private readonly maxLength;
    private readonly unicodeStrict;
    constructor(maxDepth?: number, maxLength?: number, unicodeStrict?: boolean);
    /**
     * Full normalization pipeline for policy evaluation input.
     */
    normalize(input: string): NormalizationResult;
    /**
     * URL decode: %XX → character, handles malformed sequences.
     */
    private urlDecode;
    /**
     * Decode hex escapes: \x41 → 'A', \x00 → null byte detection.
     */
    private decodeHexEscapes;
    /** Decode contiguous raw hex (e.g. 69676e6f7265 → ignore). */
    private decodeRawHexStrings;
    /**
     * Decode unicode escapes: \u0041 → 'A', \U00000041 → 'A'.
     */
    private decodeUnicodeEscapes;
    /**
     * Decode HTML entities: < -> <, &#60; -> <, &#x3C; -> <.
     * Entity map built at runtime to avoid source-level entity decoding issues.
     */
    private static htmlEntityMap;
    private static getHtmlEntityMap;
    private decodeHtmlEntities;
    /**
     * Unwrap double escapes: \\. → literal character.
     */
    private unwrapDoubleEscapes;
    /**
     * Shell normalize: collapse common shell obfuscation patterns.
     *
     * - $'cmd' → cmd (ANSI-C quoting)
     * - "c"m"d" → cmd (quote splitting)
     * - ''cmd'' → cmd (empty quote pairs)
     * - c\md → cmd (backslash escapes)
     */
    private shellNormalize;
    /**
     * Specifically normalize a JSON string value (tool argument).
     * Handles nested JSON structures recursively.
     */
    normalizeJsonValue(value: unknown, depth?: number): unknown;
    /**
     * Iteratively decode layered obfuscation (base64, URL, hex, unicode, HTML)
     * until stable or maxDepth reached. Used before prompt-injection / semantic regex.
     */
    deobfuscateRecursive(input: string, maxDepth?: number): string;
    /**
     * Decode inline base64 blobs (12+ chars) when UTF-8 decodes to printable text.
     * Also decodes whole-string base64 payloads (common prompt-injection evasion).
     */
    private decodeBase64Blobs;
}
/** Standalone recursive de-obfuscation (unicode → base64 → URL → hex → HTML). */
export declare function deobfuscateRecursive(input: string, maxDepth?: number, unicodeStrict?: boolean): string;
/**
 * Light scan: decode inline base64 blobs (capped) and flag shell/downloader text.
 * Used as belt-and-suspenders before regex policy rules.
 */
export declare function detectShellInBase64Blobs(input: string, maxBlobLen?: number): boolean;
export declare function getNormalizer(unicodeStrict?: boolean): PayloadNormalizer;
//# sourceMappingURL=payload-normalizer.d.ts.map
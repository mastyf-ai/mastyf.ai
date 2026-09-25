/** Normalize YAML-escaped policy patterns before RegExp construction. */
export declare function normalizePolicyRegexSource(pattern: string): string;
export declare function isRegexPatternSafe(pattern: string): {
    safe: boolean;
    reason?: string;
};
export declare function shouldRejectUnsafePolicyRegex(): boolean;
export declare class UnsafePolicyRegexError extends Error {
    readonly pattern: string;
    constructor(message: string, pattern: string);
}
export declare function compilePolicyRegex(pattern: string, flags?: string): RegExp;
/** Use worker-thread eval when enabled (default on in production). */
export declare function shouldUseRegexWorker(): boolean;
/** Run regex.test with bounded input length and worker-thread or wall-clock budget. */
export declare function safeRegexTest(regex: RegExp, value: string, maxChars: number): boolean;
//# sourceMappingURL=regex-compile.d.ts.map
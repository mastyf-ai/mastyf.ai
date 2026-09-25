/**
 * Constant-time string equality for security-sensitive comparisons (cache keys, tokens).
 */
export declare function constantTimeEqual(a: string, b: string): boolean;
/**
 * Compare a candidate to an expected value without early exit on first mismatch (length still checked in CT).
 */
export declare function constantTimeEqualExpected(candidate: string, expected: string): boolean;
/** SHA-256 hex digest (not for secrets — fingerprinting only). */
export declare function stableFingerprint(text: string): string;
//# sourceMappingURL=constant-time.d.ts.map
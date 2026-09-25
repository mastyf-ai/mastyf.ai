/** Hot-path semantic/LLM budget (default 500ms). */
export declare function getSemanticTimeoutMs(): number;
/** Instant attack-learning LLM budget (default 500ms). */
export declare function getInstantLlmTimeoutMs(): number;
export declare class SemanticTimeoutError extends Error {
    constructor(message?: string);
}
/**
 * Race `fn()` against a timeout. On timeout logs `semantic_timeout` and returns `fallback`.
 */
export declare function withSemanticTimeout<T>(label: string, fn: () => Promise<T>, fallback: T, timeoutMs?: number): Promise<T>;
//# sourceMappingURL=semantic-timeout.d.ts.map
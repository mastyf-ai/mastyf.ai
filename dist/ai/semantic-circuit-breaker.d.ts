type CircuitState = 'closed' | 'open' | 'half-open';
/** True when semantic LLM work should be skipped (open, or half-open probe already in flight). */
export declare function isSemanticCircuitOpen(tenantId?: string): boolean;
/**
 * Reserve a semantic LLM call slot. Returns false when open or half-open probe in flight.
 */
export declare function tryBeginSemanticLlmProbe(tenantId?: string): boolean;
/** Release half-open probe reservation when LLM call is aborted before completion. */
export declare function abortSemanticLlmProbe(tenantId?: string): void;
export declare function recordSemanticLlmSuccess(tenantId?: string): void;
export declare function recordSemanticLlmFailure(err?: unknown, tenantId?: string): void;
/** @internal */
export declare function getSemanticCircuitStateForTests(tenantId?: string): {
    state: CircuitState;
    consecutiveFailures: number;
    halfOpenProbeInFlight: boolean;
};
/** @internal — advance open → half-open without waiting for RESET_MS */
export declare function advanceSemanticCircuitForTests(tenantId?: string): void;
/** @internal */
export declare function resetSemanticCircuitForTests(): void;
export {};
//# sourceMappingURL=semantic-circuit-breaker.d.ts.map
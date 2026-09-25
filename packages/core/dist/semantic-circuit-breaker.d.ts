type CircuitState = "closed" | "open" | "half-open";
/** True when semantic LLM calls should be blocked (use local fallback / skip). */
export declare function isCoreSemanticCircuitOpen(): boolean;
/**
 * Atomically begin a semantic scan when the circuit allows it.
 * Returns false when open or when a half-open probe is already in flight.
 */
export declare function tryBeginCoreSemanticScan(): boolean;
/** @deprecated Use tryBeginCoreSemanticScan() */
export declare function markCoreSemanticProbeStart(): void;
/** Release a half-open probe when semantic scan is aborted before LLM call. */
export declare function abortCoreSemanticProbe(): void;
export declare function recordCoreSemanticSuccess(): void;
export declare function recordCoreSemanticFailure(_err?: unknown): void;
/** @internal */
export declare function getCoreSemanticCircuitStateForTests(): {
    state: CircuitState;
    consecutiveFailures: number;
    halfOpenProbeInFlight: boolean;
};
/** @internal */
export declare function resetCoreSemanticCircuitForTests(): void;
/** @internal — advance open → half-open without waiting for RESET_MS */
export declare function advanceCoreSemanticCircuitForTests(): void;
export {};
//# sourceMappingURL=semantic-circuit-breaker.d.ts.map
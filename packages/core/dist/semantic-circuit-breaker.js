/** In-process 3-state circuit breaker for core semantic LLM calls. */
const THRESHOLD = parseInt(process.env["MASTYF_AI_SEMANTIC_CIRCUIT_THRESHOLD"] ||
    process.env["MASTYF_AI_SEMANTIC_CIRCUIT_THRESHOLD"] ||
    "5", 10);
const RESET_MS = parseInt(process.env["MASTYF_AI_SEMANTIC_CIRCUIT_RESET_MS"] ||
    process.env["MASTYF_AI_SEMANTIC_CIRCUIT_RESET_MS"] ||
    "60000", 10);
let state = "closed";
let consecutiveFailures = 0;
let openUntil = 0;
let halfOpenProbeInFlight = false;
function tickCircuitState() {
    if (state === "open" && Date.now() >= openUntil) {
        state = "half-open";
        halfOpenProbeInFlight = false;
    }
}
/** True when semantic LLM calls should be blocked (use local fallback / skip). */
export function isCoreSemanticCircuitOpen() {
    tickCircuitState();
    if (state === "open")
        return true;
    if (state === "half-open" && halfOpenProbeInFlight)
        return true;
    return false;
}
/**
 * Atomically begin a semantic scan when the circuit allows it.
 * Returns false when open or when a half-open probe is already in flight.
 */
export function tryBeginCoreSemanticScan() {
    tickCircuitState();
    if (state === "open")
        return false;
    if (state === "half-open") {
        if (halfOpenProbeInFlight)
            return false;
        halfOpenProbeInFlight = true;
    }
    return true;
}
/** @deprecated Use tryBeginCoreSemanticScan() */
export function markCoreSemanticProbeStart() {
    tryBeginCoreSemanticScan();
}
/** Release a half-open probe when semantic scan is aborted before LLM call. */
export function abortCoreSemanticProbe() {
    if (state === "half-open" && halfOpenProbeInFlight) {
        halfOpenProbeInFlight = false;
    }
}
export function recordCoreSemanticSuccess() {
    tickCircuitState();
    if (state === "half-open") {
        state = "closed";
        consecutiveFailures = 0;
        openUntil = 0;
        halfOpenProbeInFlight = false;
        return;
    }
    consecutiveFailures = Math.max(0, consecutiveFailures - 1);
}
export function recordCoreSemanticFailure(_err) {
    tickCircuitState();
    if (state === "half-open") {
        state = "open";
        openUntil = Date.now() + RESET_MS;
        halfOpenProbeInFlight = false;
        return;
    }
    consecutiveFailures++;
    if (consecutiveFailures >= THRESHOLD) {
        state = "open";
        openUntil = Date.now() + RESET_MS;
    }
}
/** @internal */
export function getCoreSemanticCircuitStateForTests() {
    tickCircuitState();
    return { state, consecutiveFailures, halfOpenProbeInFlight };
}
/** @internal */
export function resetCoreSemanticCircuitForTests() {
    state = "closed";
    consecutiveFailures = 0;
    openUntil = 0;
    halfOpenProbeInFlight = false;
}
/** @internal — advance open → half-open without waiting for RESET_MS */
export function advanceCoreSemanticCircuitForTests() {
    if (state === "open") {
        openUntil = 0;
        tickCircuitState();
    }
}
//# sourceMappingURL=semantic-circuit-breaker.js.map
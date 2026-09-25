/**
 * Decide-latency SLO: prefer live /v1/status intelligence.latency_ms,
 * else p50 of receipt total_latency_ms. Never invent 0 from empty samples.
 */
export function sloDecideLatencyMs(statusLatency, receiptLatencies) {
    if (typeof statusLatency === 'number' && Number.isFinite(statusLatency)) {
        return statusLatency;
    }
    const samples = receiptLatencies.filter((n) => typeof n === 'number' && Number.isFinite(n));
    if (samples.length === 0)
        return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
//# sourceMappingURL=slo-decide-latency.js.map
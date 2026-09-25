/**
 * Decide-latency SLO: prefer live /v1/status intelligence.latency_ms,
 * else p50 of receipt total_latency_ms. Never invent 0 from empty samples.
 */
export declare function sloDecideLatencyMs(statusLatency: number | null | undefined, receiptLatencies: Array<number | null | undefined>): number | null;
//# sourceMappingURL=slo-decide-latency.d.ts.map
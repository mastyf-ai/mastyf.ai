function percentile(values, p) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
    return sorted[idx];
}
export function buildSimilarEnvironmentBenchmarks(records) {
    const byServer = new Map();
    for (const r of records) {
        const server = r.serverName || 'unknown';
        const arr = byServer.get(server) || [];
        arr.push(r);
        byServer.set(server, arr);
    }
    const stats = [...byServer.entries()].map(([serverName, recs]) => {
        const totalCalls = recs.length;
        const blocked = recs.filter((r) => !!r.blocked).length;
        const blockedRate = totalCalls > 0 ? blocked / totalCalls : 0;
        const avgLatencyMs = totalCalls > 0 ? recs.reduce((s, r) => s + (r.durationMs || 0), 0) / totalCalls : 0;
        const avgTokens = totalCalls > 0 ? recs.reduce((s, r) => s + (r.totalTokens || 0), 0) / totalCalls : 0;
        return { serverName, totalCalls, blockedRate, avgLatencyMs, avgTokens };
    });
    return stats.map((row) => {
        const peers = stats.filter((p) => p.serverName !== row.serverName);
        const peerBlocked = peers.map((p) => p.blockedRate);
        const peerLatency = peers.map((p) => p.avgLatencyMs);
        const peerBlockedRateP50 = percentile(peerBlocked, 50);
        const peerBlockedRateP90 = percentile(peerBlocked, 90);
        const peerLatencyP50 = percentile(peerLatency, 50);
        const peerLatencyP90 = percentile(peerLatency, 90);
        let status = 'neutral';
        if (row.avgLatencyMs > peerLatencyP90 * 1.1 || row.blockedRate < peerBlockedRateP50 * 0.8) {
            status = 'needs_attention';
        }
        else if (row.avgLatencyMs <= peerLatencyP50 && row.blockedRate >= peerBlockedRateP50) {
            status = 'outperforming';
        }
        return {
            ...row,
            blockedRate: Math.round(row.blockedRate * 1000) / 1000,
            avgLatencyMs: Math.round(row.avgLatencyMs),
            avgTokens: Math.round(row.avgTokens),
            peerBlockedRateP50: Math.round(peerBlockedRateP50 * 1000) / 1000,
            peerBlockedRateP90: Math.round(peerBlockedRateP90 * 1000) / 1000,
            peerLatencyP50: Math.round(peerLatencyP50),
            peerLatencyP90: Math.round(peerLatencyP90),
            status,
        };
    }).sort((a, b) => b.totalCalls - a.totalCalls);
}
//# sourceMappingURL=similar-environment-benchmarks.js.map
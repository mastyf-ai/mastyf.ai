function hashArgs(args) {
    const raw = JSON.stringify(args || {});
    let h = 0;
    for (let i = 0; i < raw.length; i++)
        h = ((h << 5) - h) + raw.charCodeAt(i);
    return Math.abs(h).toString(36);
}
export function buildTenantSimulationPack(tenantId, records, opts) {
    const maxSeeds = opts?.maxSeeds ?? 40;
    const byTool = new Map();
    for (const r of records) {
        const tool = r.toolName || 'unknown';
        const cur = byTool.get(tool) || { calls: 0, blocked: 0 };
        cur.calls += 1;
        if (r.blocked)
            cur.blocked += 1;
        byTool.set(tool, cur);
    }
    const toolFingerprint = [...byTool.entries()]
        .map(([toolName, v]) => ({
        toolName,
        calls: v.calls,
        blockedRate: v.calls > 0 ? Math.round((v.blocked / v.calls) * 1000) / 1000 : 0,
    }))
        .sort((a, b) => b.calls - a.calls);
    const blockedTarget = Math.max(1, Math.floor(maxSeeds * 0.5));
    const benignTarget = Math.max(1, Math.floor(maxSeeds * 0.3));
    const mixedTarget = Math.max(1, maxSeeds - blockedTarget - benignTarget);
    const seen = new Set();
    const topTools = new Set(toolFingerprint.slice(0, 8).map((t) => t.toolName));
    const blockedPool = [];
    const benignPool = [];
    const mixedPool = [];
    const categoryByTool = new Map(toolFingerprint.map((t) => [
        t.toolName,
        t.blockedRate > 0.2 && t.blockedRate < 0.8 ? 'mixed' : (t.blockedRate >= 0.8 ? 'high_risk' : 'benign_like'),
    ]));
    for (const r of records) {
        const toolName = r.toolName || 'unknown';
        if (!topTools.has(toolName))
            continue;
        if (!r.arguments || typeof r.arguments !== 'object')
            continue;
        const args = r.arguments;
        const key = `${toolName}:${hashArgs(args)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        const observedBlocked = !!r.blocked;
        const toolCategory = categoryByTool.get(toolName) || (observedBlocked ? 'high_risk' : 'benign_like');
        const seed = {
            id: `sim-${key}`,
            toolName,
            arguments: args,
            observedBlocked,
            category: toolCategory,
        };
        if (toolCategory === 'mixed')
            mixedPool.push(seed);
        else if (observedBlocked)
            blockedPool.push(seed);
        else
            benignPool.push(seed);
    }
    const seedCases = [];
    const take = (pool, n) => {
        for (const row of pool) {
            if (seedCases.length >= maxSeeds || n <= 0)
                break;
            seedCases.push(row);
            n--;
        }
    };
    take(blockedPool, blockedTarget);
    take(benignPool, benignTarget);
    take(mixedPool, mixedTarget);
    if (seedCases.length < maxSeeds) {
        for (const row of [...blockedPool, ...benignPool, ...mixedPool]) {
            if (seedCases.length >= maxSeeds)
                break;
            if (seedCases.find((s) => s.id === row.id))
                continue;
            seedCases.push(row);
        }
    }
    return {
        tenantId,
        generatedAt: new Date().toISOString(),
        totalRecordsScanned: records.length,
        toolFingerprint,
        seedCases,
    };
}
//# sourceMappingURL=tenant-simulation-pack.js.map
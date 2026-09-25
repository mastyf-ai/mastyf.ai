const OFF_HOURS_START = 22;
const OFF_HOURS_END = 6;
function sessionKey(rec) {
    const tenant = rec.tenantId || 'default';
    return `${tenant}:${rec.serverName}`;
}
function agentIdFromRecord(rec) {
    return rec.serverName;
}
function isOffHours(ts) {
    const h = new Date(ts).getUTCHours();
    return h >= OFF_HOURS_START || h < OFF_HOURS_END;
}
function detectToolLoop(tools) {
    if (tools.length < 4)
        return 0;
    const counts = new Map();
    for (const t of tools)
        counts.set(t, (counts.get(t) || 0) + 1);
    const max = Math.max(...counts.values());
    return max / tools.length;
}
export function computeAgentAbuseScore(sessionKeyStr, records, semanticRecords) {
    const callCount = records.length;
    const blockedCount = records.filter((r) => r.blocked).length;
    const blockRate = callCount > 0 ? blockedCount / callCount : 0;
    const totalCostUsd = records.reduce((s, r) => s + (Number(r.costUsd) || 0), 0);
    const toolSequence = records.map((r) => r.toolName);
    const loopRatio = detectToolLoop(toolSequence);
    const semantics = semanticRecords.filter((s) => s.serverName === records[0]?.serverName && s.semanticAudit?.suspicious);
    const semanticFlags = semantics.length;
    const offHoursCalls = records.filter((r) => isOffHours(String(r.timestamp))).length;
    const offHoursRate = callCount > 0 ? offHoursCalls / callCount : 0;
    const costVelocity = callCount >= 2
        ? totalCostUsd / Math.max(1, (Date.parse(records[records.length - 1].timestamp) - Date.parse(records[0].timestamp)) / 3600000)
        : totalCostUsd;
    const factors = [];
    function add(name, weight, raw, detail) {
        const normalized = Math.min(1, raw);
        factors.push({
            name,
            weight,
            raw,
            contribution: Math.round(normalized * weight * 100) / 100,
            detail,
        });
    }
    add('block_rate', 0.3, blockRate, `${Math.round(blockRate * 100)}% of calls blocked`);
    add('semantic_flags', 0.25, Math.min(1, semanticFlags / 3), `${semanticFlags} semantic flag(s)`);
    add('cost_velocity', 0.2, Math.min(1, costVelocity / 5), `$${costVelocity.toFixed(4)}/hr spend velocity`);
    add('tool_loops', 0.15, loopRatio, `${Math.round(loopRatio * 100)}% repeat-tool concentration`);
    add('off_hours', 0.1, offHoursRate, `${Math.round(offHoursRate * 100)}% off-hours activity`);
    const score = Math.round(Math.min(100, factors.reduce((s, f) => s + f.contribution, 0) * 100));
    const riskLevel = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
    const topFactor = [...factors].sort((a, b) => b.contribution - a.contribution)[0];
    const summary = topFactor
        ? `Abuse score ${score}/100 — primary driver: ${topFactor.detail}`
        : `Abuse score ${score}/100`;
    return {
        sessionKey: sessionKeyStr,
        agentId: agentIdFromRecord(records[0]),
        serverName: records[0]?.serverName || 'unknown',
        score,
        riskLevel,
        factors,
        callCount,
        blockedCount,
        semanticFlags,
        totalCostUsd,
        summary,
    };
}
export function computeAgentAbuseScores(records, semanticRecords, opts) {
    const bySession = new Map();
    for (const r of records) {
        const key = sessionKey(r);
        const list = bySession.get(key) || [];
        list.push(r);
        bySession.set(key, list);
    }
    const scores = [...bySession.entries()].map(([key, recs]) => computeAgentAbuseScore(key, recs, semanticRecords));
    return scores.sort((a, b) => b.score - a.score).slice(0, opts?.limit ?? 20);
}
//# sourceMappingURL=agent-abuse-score.js.map
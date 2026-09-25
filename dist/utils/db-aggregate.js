export async function getAllActiveServerNames(db, tenantId) {
    if ('getDistinctActiveServers' in db && typeof db.getDistinctActiveServers === 'function') {
        return db.getDistinctActiveServers(tenantId);
    }
    return db.getDistinctScannedServers(tenantId);
}
export function parseSecurityScanDetails(scan) {
    if (!scan || typeof scan !== 'object')
        return null;
    const row = scan;
    let details = row.details;
    if (typeof details === 'string') {
        try {
            details = JSON.parse(details);
        }
        catch {
            details = null;
        }
    }
    if (details && typeof details === 'object')
        return details;
    return null;
}
export function summarizeRecords(records) {
    let blocked = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalLatency = 0;
    let costUsd = 0;
    let pricedCalls = 0;
    let unpricedCalls = 0;
    const models = new Set();
    for (const r of records) {
        if (r.blocked)
            blocked++;
        totalInput += r.requestTokens || 0;
        totalOutput += r.responseTokens || 0;
        totalLatency += r.durationMs || 0;
        if (r.costUsd != null && r.costUsd > 0) {
            costUsd += r.costUsd;
            pricedCalls++;
        }
        else if (!r.blocked || (r.requestTokens || 0) > 0) {
            unpricedCalls++;
        }
        if (r.model)
            models.add(r.model);
    }
    const total = records.length;
    return {
        total,
        blocked,
        passed: total - blocked,
        totalInput,
        totalOutput,
        totalLatency,
        costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
        pricedCalls,
        unpricedCalls,
        models: [...models],
    };
}
export async function loadAllCallRecords(db, servers, tenantId) {
    const all = [];
    for (const srv of servers) {
        all.push(...(await db.getCallRecordsForServer(srv, undefined, tenantId)));
    }
    return all;
}
function liveTrafficWindowMs() {
    const n = parseInt(process.env.MASTYF_AI_TUI_ACTIVE_WINDOW_MS || String(15 * 60 * 1000), 10);
    return Number.isFinite(n) && n > 0 ? n : 15 * 60 * 1000;
}
export function aggregateInstancesByServer(records, serverNames, nowMs = Date.now()) {
    const liveMs = liveTrafficWindowMs();
    return serverNames.map((name) => {
        const recs = records.filter((r) => r.serverName === name);
        const sum = summarizeRecords(recs);
        let lastMs = 0;
        for (const r of recs) {
            const t = new Date(r.timestamp || 0).getTime();
            if (!Number.isNaN(t) && t > lastMs)
                lastMs = t;
        }
        const status = recs.length === 0 ? 'offline' :
            nowMs - lastMs <= liveMs ? 'active' :
                'degraded';
        return {
            instanceId: name,
            instanceName: name,
            status,
            hostname: 'mcp-server',
            version: recs.length > 0 ? 'live' : '—',
            lastHeartbeat: lastMs > 0 ? new Date(lastMs).toISOString() : '',
            totalRequests: sum.total,
            blockedRequests: sum.blocked,
            totalCostUsd: sum.costUsd,
            avgLatencyMs: sum.total > 0 ? Math.round(sum.totalLatency / sum.total) : 0,
        };
    });
}
export function cveCountFromScanRow(scan) {
    const report = parseSecurityScanDetails(scan);
    if (report?.cves?.length)
        return report.cves.length;
    const n = scan.cves_found ?? scan.cve_count;
    return typeof n === 'number' ? n : 0;
}
export function securityRowFromScan(scan, fallbackName) {
    const report = parseSecurityScanDetails(scan);
    const cves = report?.cves || [];
    return {
        name: scan.server_name || fallbackName,
        score: scan.score || 0,
        cves: cveCountFromScanRow(scan),
        critical: cves.filter((c) => c.severity === 'CRITICAL').length,
        high: cves.filter((c) => c.severity === 'HIGH').length,
        auth: !!(report?.authStatus?.hasAuthentication),
    };
}
//# sourceMappingURL=db-aggregate.js.map
import { createDatabaseSync } from '../database/create-database.js';
import { getAllActiveServerNames, summarizeRecords } from './db-aggregate.js';
import { resolveMastyfAiDbPath } from './mastyf-ai-db-path.js';
import { Logger } from './logger.js';
let cachedDb = null;
let initPromise = null;
async function getHistoryDb() {
    if (!cachedDb)
        cachedDb = createDatabaseSync();
    if (!initPromise) {
        initPromise = cachedDb.initialize().then(() => undefined);
    }
    await initPromise;
    return cachedDb;
}
export async function collectProxyHeartbeatMetrics() {
    try {
        const db = await getHistoryDb();
        const tenantId = process.env.MASTYF_AI_TENANT_ID || 'default';
        const windowDays = parseInt(process.env.MASTYF_AI_HEARTBEAT_METRICS_DAYS || '7', 10);
        const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
        const servers = await getAllActiveServerNames(db, tenantId);
        let total = 0;
        let blocked = 0;
        let costUsd = 0;
        const ruleCounts = new Map();
        for (const srv of servers) {
            const recs = await db.getCallRecordsForServer(srv, undefined, tenantId);
            for (const r of recs) {
                const ts = new Date(r.timestamp).getTime();
                if (!Number.isFinite(ts) || ts < cutoffMs)
                    continue;
                total++;
                if (r.blocked) {
                    blocked++;
                    if (r.blockRule) {
                        ruleCounts.set(r.blockRule, (ruleCounts.get(r.blockRule) ?? 0) + 1);
                    }
                }
                if (r.costUsd != null && r.costUsd > 0)
                    costUsd += r.costUsd;
            }
        }
        const topBlockRules = [...ruleCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([rule, count]) => ({ rule, count }));
        if (total === 0 && servers.length === 0) {
            return {};
        }
        return {
            totalRequests: total,
            blockedRequests: blocked,
            totalCostUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
            topBlockRules,
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.debug(`[heartbeat-metrics] ${msg} (db=${resolveMastyfAiDbPath()})`);
        return {};
    }
}
/** @deprecated use collectProxyHeartbeatMetrics */
export function aggregateCallRecordsFromDb(summary, rules) {
    return {
        totalRequests: summary.total,
        blockedRequests: summary.blocked,
        totalCostUsd: Math.round(summary.cost * 1_000_000) / 1_000_000,
        topBlockRules: rules.map((r) => ({ rule: r.rule, count: r.cnt })),
    };
}
export { summarizeRecords };
//# sourceMappingURL=heartbeat-proxy-metrics.js.map
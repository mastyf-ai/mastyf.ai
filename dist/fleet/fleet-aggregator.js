/**
 * Fleet-wide status — Postgres mastyf_ai_instances or multiple SQLite DB paths.
 */
import { existsSync } from 'fs';
import { HistoryDatabase } from '../database/history-db.js';
import { aggregateInstancesByServer, getAllActiveServerNames, loadAllCallRecords, summarizeRecords, } from '../utils/db-aggregate.js';
import { Logger } from '../utils/logger.js';
import { getMastyfAiRegion } from '../utils/region.js';
async function loadFromPostgres() {
    const dbUrl = process.env['DATABASE_URL'];
    if (!dbUrl || process.env['DB_TYPE']?.toLowerCase() !== 'postgres')
        return null;
    try {
        const { loadPg } = await import('../database/pg-loader.js');
        const { Pool } = await loadPg();
        const pool = new Pool({ connectionString: dbUrl, max: 3 });
        const client = await pool.connect();
        try {
            const inst = await client.query(`SELECT instance_id, instance_name, hostname, status, last_heartbeat,
                COALESCE(metadata->>'region', '') AS region
         FROM mastyf_ai_instances
         ORDER BY last_heartbeat DESC NULLS LAST
         LIMIT 500`);
            const metrics = await client.query(`SELECT instance_id,
                COALESCE(SUM(total_requests), 0)::bigint AS total_requests,
                COALESCE(SUM(blocked_requests), 0)::bigint AS blocked_requests,
                COALESCE(SUM(total_cost_usd), 0)::float AS total_cost_usd
         FROM aggregated_metrics
         WHERE timestamp > NOW() - INTERVAL '1 hour'
         GROUP BY instance_id`);
            const metricsById = new Map(metrics.rows.map((r) => [r.instance_id, r]));
            const instances = inst.rows.map((row) => {
                const m = metricsById.get(row.instance_id);
                return {
                    instanceId: row.instance_id,
                    instanceName: row.instance_name,
                    hostname: row.hostname || 'unknown',
                    status: row.status || 'unknown',
                    region: row.region || undefined,
                    lastHeartbeat: row.last_heartbeat?.toISOString?.() || String(row.last_heartbeat),
                    totalRequests: Number(m?.total_requests || 0),
                    blockedRequests: Number(m?.blocked_requests || 0),
                    totalCostUsd: Number(m?.total_cost_usd || 0),
                };
            });
            const active = instances.filter((i) => i.status === 'active').length;
            return {
                region: getMastyfAiRegion(),
                source: 'postgres',
                totalInstances: instances.length,
                activeInstances: active,
                totalRequests: instances.reduce((s, i) => s + i.totalRequests, 0),
                totalBlocked: instances.reduce((s, i) => s + i.blockedRequests, 0),
                totalCostUsd: instances.reduce((s, i) => s + i.totalCostUsd, 0),
                instances,
            };
        }
        finally {
            client.release();
            await pool.end();
        }
    }
    catch (err) {
        Logger.warn(`[fleet] Postgres fleet query failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
async function loadFromSqlitePath(dbPath, label) {
    if (!existsSync(dbPath))
        return [];
    const db = new HistoryDatabase(dbPath);
    await db.initialize();
    try {
        const servers = await getAllActiveServerNames(db);
        const records = await loadAllCallRecords(db, servers);
        const rows = aggregateInstancesByServer(records, servers);
        const sum = summarizeRecords(records);
        return [{
                instanceId: label,
                instanceName: label,
                hostname: label,
                status: rows.some((r) => r.status === 'active') ? 'active' : 'degraded',
                lastHeartbeat: new Date().toISOString(),
                totalRequests: sum.total,
                blockedRequests: sum.blocked,
                totalCostUsd: sum.costUsd,
                dbPath,
            }];
    }
    finally {
        await db.close();
    }
}
export async function getFleetStatus() {
    const pg = await loadFromPostgres();
    if (pg)
        return pg;
    const paths = (process.env['MASTYF_AI_FLEET_DB_PATHS'] || process.env['MASTYF_AI_DB_PATH'] || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    if (paths.length === 0) {
        const { resolveMastyfAiDbPath } = await import('../utils/mastyf-ai-db-path.js');
        paths.push(resolveMastyfAiDbPath());
    }
    const instances = [];
    for (const p of paths) {
        const label = p.split('/').pop() || p;
        instances.push(...(await loadFromSqlitePath(p, label)));
    }
    return {
        region: getMastyfAiRegion(),
        source: paths.length > 1 ? 'multi-sqlite' : 'sqlite',
        totalInstances: instances.length,
        activeInstances: instances.filter((i) => i.status === 'active').length,
        totalRequests: instances.reduce((s, i) => s + i.totalRequests, 0),
        totalBlocked: instances.reduce((s, i) => s + i.blockedRequests, 0),
        totalCostUsd: instances.reduce((s, i) => s + i.totalCostUsd, 0),
        instances,
    };
}
//# sourceMappingURL=fleet-aggregator.js.map
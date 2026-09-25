/**
 * Read-only PostgreSQL reader for unified_audit_trail / fleet tables.
 * Used by dashboard when proxies sync SQLite → shared Postgres.
 */
import { loadPg } from '../database/pg-loader.js';
import { runMigrations } from '../database/migration-runner.js';
import { parseWindowDays, windowRangeMs } from './time-buckets.js';
import { Logger } from './logger.js';
let sharedPool = null;
export async function initUnifiedDataReaderPool(databaseUrl) {
    const url = databaseUrl || process.env['DATABASE_URL'];
    if (!url)
        return null;
    if (sharedPool)
        return sharedPool;
    const { Pool } = await loadPg();
    sharedPool = new Pool({
        connectionString: url,
        max: 5,
        idleTimeoutMillis: 30000,
    });
    await runMigrations(sharedPool);
    Logger.info('[UnifiedDataReader] PostgreSQL pool initialized (read-only)');
    return sharedPool;
}
export function getUnifiedDataReaderPool() {
    return sharedPool;
}
export async function closeUnifiedDataReaderPool() {
    if (sharedPool) {
        await sharedPool.end();
        sharedPool = null;
    }
}
function mapAuditRow(row) {
    const action = String(row.action || 'pass');
    return {
        serverName: String(row.server_name || ''),
        toolName: String(row.tool_name || ''),
        requestTokens: Number(row.request_tokens) || 0,
        responseTokens: Number(row.response_tokens) || 0,
        totalTokens: Number(row.total_tokens) || 0,
        durationMs: Number(row.duration_ms) || 0,
        timestamp: row.timestamp instanceof Date
            ? row.timestamp.toISOString()
            : String(row.timestamp || new Date().toISOString()),
        model: row.model ? String(row.model) : undefined,
        costUsd: row.estimated_cost_usd != null ? Number(row.estimated_cost_usd) : undefined,
        blocked: action === 'block',
        blockRule: row.rule_name ? String(row.rule_name) : undefined,
        blockReason: row.reason ? String(row.reason) : undefined,
        tenantId: row.tenant_id ? String(row.tenant_id) : 'default',
    };
}
export class UnifiedDataReader {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async loadCallRecordsInWindow(tenantId, windowDaysInput, region) {
        const windowDays = parseWindowDays(windowDaysInput);
        const { startMs, endMs } = windowRangeMs(windowDays);
        const startIso = new Date(startMs).toISOString();
        const endIso = new Date(endMs).toISOString();
        const tid = tenantId || 'default';
        const client = await this.pool.connect();
        try {
            let sql = `
        SELECT uat.*
        FROM unified_audit_trail uat
      `;
            const params = [tid, startIso, endIso];
            if (region?.trim()) {
                sql += ` INNER JOIN mastyf_ai_instances gi ON gi.instance_id = uat.instance_id
                 AND COALESCE(gi.metadata->>'region', '') = $4 `;
                params.push(region.trim());
            }
            sql += ` WHERE uat.tenant_id = $1 AND uat.timestamp >= $2 AND uat.timestamp <= $3
               ORDER BY uat.timestamp DESC
               LIMIT 500000`;
            const result = await client.query(sql, params);
            return result.rows.map((row) => mapAuditRow(row));
        }
        finally {
            client.release();
        }
    }
    async aggregateHourlyTraffic(tenantId, windowDaysInput, region) {
        const records = await this.loadCallRecordsInWindow(tenantId, windowDaysInput, region);
        const byHour = new Map();
        for (const r of records) {
            const ts = Date.parse(String(r.timestamp || ''));
            if (!Number.isFinite(ts))
                continue;
            const bucket = new Date(ts).toISOString().slice(0, 13) + ':00:00.000Z';
            const cur = byHour.get(bucket) || { bucket, total: 0, blocked: 0, costUsd: 0 };
            cur.total++;
            if (r.blocked)
                cur.blocked++;
            cur.costUsd += Number(r.costUsd) || 0;
            byHour.set(bucket, cur);
        }
        return [...byHour.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
    }
    async aggregateCostTimeseries(tenantId, windowDaysInput, granularity, region) {
        const records = await this.loadCallRecordsInWindow(tenantId, windowDaysInput, region);
        const points = new Map();
        for (const r of records) {
            const ts = Date.parse(String(r.timestamp || ''));
            if (!Number.isFinite(ts))
                continue;
            const bucket = granularity === 'hour'
                ? new Date(ts).toISOString().slice(0, 13) + ':00:00.000Z'
                : new Date(ts).toISOString().slice(0, 10);
            const key = `${bucket}|${r.serverName}`;
            const cur = points.get(key) || { bucket, server: r.serverName, costUsd: 0, calls: 0 };
            cur.calls++;
            cur.costUsd += Number(r.costUsd) || 0;
            points.set(key, cur);
        }
        return [...points.values()];
    }
    async queryAuditEvents(tenantId, opts) {
        const records = await this.loadCallRecordsInWindow(tenantId, 90, opts.region);
        let filtered = records;
        if (opts.server)
            filtered = filtered.filter((r) => r.serverName === opts.server);
        if (opts.action === 'block')
            filtered = filtered.filter((r) => r.blocked);
        else if (opts.action === 'pass')
            filtered = filtered.filter((r) => !r.blocked);
        const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
        return filtered
            .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
            .slice(0, limit)
            .map((r) => ({
            timestamp: r.timestamp,
            server_name: r.serverName,
            tool_name: r.toolName,
            action: r.blocked ? 'block' : 'pass',
            rule: r.blockRule,
            reason: r.blockReason,
            request_tokens: r.requestTokens,
            response_tokens: r.responseTokens,
            total_tokens: r.totalTokens,
            duration_ms: r.durationMs,
        }));
    }
    async getFleetInstancesFromPg() {
        const client = await this.pool.connect();
        try {
            const inst = await client.query(`SELECT instance_id, instance_name, hostname, status, last_heartbeat,
                COALESCE(metadata->>'region', '') AS region
         FROM mastyf_ai_instances
         ORDER BY last_heartbeat DESC NULLS LAST
         LIMIT 500`);
            const metrics = await client.query(`SELECT instance_id,
                COUNT(*)::bigint AS total_requests,
                COUNT(*) FILTER (WHERE action = 'block')::bigint AS blocked_requests,
                COALESCE(SUM(estimated_cost_usd), 0)::float AS total_cost_usd
         FROM unified_audit_trail
         WHERE timestamp > NOW() - INTERVAL '1 hour'
         GROUP BY instance_id`);
            const metricsById = new Map(metrics.rows.map((r) => [r.instance_id, r]));
            return inst.rows.map((row) => {
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
        }
        finally {
            client.release();
        }
    }
    async listRegions() {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`SELECT DISTINCT COALESCE(metadata->>'region', '') AS region
         FROM mastyf_ai_instances
         WHERE COALESCE(metadata->>'region', '') <> ''
         ORDER BY region`);
            return result.rows.map((r) => r.region).filter(Boolean);
        }
        finally {
            client.release();
        }
    }
}
//# sourceMappingURL=unified-data-reader.js.map
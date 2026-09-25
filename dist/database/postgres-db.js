import { Logger } from '../utils/logger.js';
import { loadPg } from './pg-loader.js';
import { runMigrations } from './migration-runner.js';
import { isPostgresRlsEnabled, withPostgresTenantSession } from './postgres-tenant-session.js';
import { decryptField, encryptAuditArgsField, encryptField, } from '../utils/field-encryption.js';
export class PostgresDatabase {
    pool;
    initialized = false;
    connectionString;
    constructor() {
        this.connectionString = process.env['DATABASE_URL'] || 'postgresql://localhost:5432/mastyf_ai';
    }
    /** Run query under Postgres RLS session when enabled and tenantId is set. */
    async tenantQuery(tenantId, sql, params) {
        if (isPostgresRlsEnabled() && tenantId) {
            return withPostgresTenantSession(this.pool, tenantId, (client) => client.query(sql, params));
        }
        return this.pool.query(sql, params);
    }
    async initialize() {
        if (this.initialized)
            return;
        const { Pool } = await loadPg();
        const poolMax = parseInt(process.env['MASTYF_AI_PG_POOL_MAX'] ?? '10', 10);
        this.pool = new Pool({
            connectionString: this.connectionString,
            max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
            idleTimeoutMillis: 30000,
        });
        const client = await this.pool.connect();
        try {
            await client.query(`
        CREATE TABLE IF NOT EXISTS security_scans (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ DEFAULT NOW(),
          server_name TEXT NOT NULL,
          score INTEGER NOT NULL,
          cve_count INTEGER NOT NULL DEFAULT 0,
          details JSONB
        )
      `);
            await client.query(`
        CREATE TABLE IF NOT EXISTS cost_records (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ DEFAULT NOW(),
          server_name TEXT NOT NULL,
          tokens_used INTEGER NOT NULL,
          cost_usd REAL NOT NULL
        )
      `);
            await client.query(`
        CREATE TABLE IF NOT EXISTS health_checks (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ DEFAULT NOW(),
          server_name TEXT NOT NULL,
          latency_ms INTEGER NOT NULL,
          success INTEGER NOT NULL,
          tool_count INTEGER NOT NULL
        )
      `);
            await client.query(`
        CREATE TABLE IF NOT EXISTS call_records (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ DEFAULT NOW(),
          server_name TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          request_tokens INTEGER NOT NULL DEFAULT 0,
          response_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0
        )
      `);
            await client.query('CREATE INDEX IF NOT EXISTS idx_security_server ON security_scans(server_name)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_cost_server ON cost_records(server_name)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_health_server ON health_checks(server_name)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_call_server ON call_records(server_name)');
            await client.query('ALTER TABLE call_records ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT false');
            await client.query('ALTER TABLE call_records ADD COLUMN IF NOT EXISTS block_rule TEXT');
            await client.query('ALTER TABLE call_records ADD COLUMN IF NOT EXISTS block_reason TEXT');
            await client.query('ALTER TABLE call_records ADD COLUMN IF NOT EXISTS model TEXT');
            await client.query('ALTER TABLE call_records ADD COLUMN IF NOT EXISTS cost_usd REAL');
            await client.query('ALTER TABLE call_records ADD COLUMN IF NOT EXISTS pricing_source TEXT');
            await client.query('ALTER TABLE call_records ADD COLUMN IF NOT EXISTS token_source TEXT');
            await client.query('ALTER TABLE call_records ADD COLUMN IF NOT EXISTS argument_snippet TEXT');
            await runMigrations(this.pool);
            this.initialized = true;
            Logger.info('PostgreSQL database initialized');
        }
        finally {
            client.release();
        }
    }
    async getRecentSuccessRate(serverName, tenantId) {
        const result = tenantId
            ? await this.tenantQuery(tenantId, `SELECT AVG(success) as avg FROM (
           SELECT success FROM health_checks
           WHERE server_name = $1 AND tenant_id = $2
           ORDER BY timestamp DESC
           LIMIT 10
         ) AS recent`, [serverName, tenantId])
            : await this.pool.query(`SELECT AVG(success) as avg FROM (
           SELECT success FROM health_checks
           WHERE server_name = $1
           ORDER BY timestamp DESC
           LIMIT 10
         ) AS recent`, [serverName]);
        if (result.rows.length > 0 && result.rows[0].avg !== null) {
            return Number(result.rows[0].avg);
        }
        return null;
    }
    async addSecurityScan(serverName, score, cveCount, details, tenantId = 'default') {
        await this.tenantQuery(tenantId, 'INSERT INTO security_scans (server_name, score, cve_count, details, tenant_id) VALUES ($1, $2, $3, $4, $5)', [serverName, score, cveCount, JSON.stringify(details), tenantId]);
    }
    async getLatestSecurityScan(serverName, tenantId) {
        const result = tenantId
            ? await this.tenantQuery(tenantId, 'SELECT * FROM security_scans WHERE server_name = $1 AND tenant_id = $2 ORDER BY id DESC LIMIT 1', [serverName, tenantId])
            : await this.pool.query('SELECT * FROM security_scans WHERE server_name = $1 ORDER BY id DESC LIMIT 1', [serverName]);
        return result.rows.length > 0 ? result.rows[0] : null;
    }
    async getDistinctScannedServers(tenantId) {
        const result = tenantId
            ? await this.tenantQuery(tenantId, 'SELECT DISTINCT server_name FROM security_scans WHERE tenant_id = $1 ORDER BY server_name', [tenantId])
            : await this.pool.query('SELECT DISTINCT server_name FROM security_scans ORDER BY server_name');
        return result.rows.map((r) => String(r.server_name));
    }
    async getDistinctActiveServers(tenantId) {
        const result = tenantId
            ? await this.tenantQuery(tenantId, `SELECT DISTINCT server_name FROM (
           SELECT server_name FROM security_scans WHERE tenant_id = $1
           UNION
           SELECT server_name FROM call_records WHERE tenant_id = $1
         ) AS active ORDER BY server_name`, [tenantId, tenantId])
            : await this.pool.query(`SELECT DISTINCT server_name FROM (
           SELECT server_name FROM security_scans
           UNION
           SELECT server_name FROM call_records
         ) AS active ORDER BY server_name`);
        return result.rows.map((r) => String(r.server_name));
    }
    async addCostRecord(serverName, tokens, cost, tenantId = 'default') {
        await this.tenantQuery(tenantId, 'INSERT INTO cost_records (server_name, tokens_used, cost_usd, tenant_id) VALUES ($1, $2, $3, $4)', [serverName, tokens, cost, tenantId]);
    }
    async addHealthCheck(serverName, latency, success, toolCount, tenantId = 'default') {
        await this.tenantQuery(tenantId, 'INSERT INTO health_checks (server_name, latency_ms, success, tool_count, tenant_id) VALUES ($1, $2, $3, $4, $5)', [serverName, latency, success ? 1 : 0, toolCount, tenantId]);
    }
    async addCallRecord(record) {
        const tid = record.tenantId ?? 'default';
        await this.tenantQuery(tid, 'INSERT INTO call_records (server_name, tool_name, request_tokens, response_tokens, total_tokens, duration_ms, blocked, block_rule, block_reason, argument_snippet, model, cost_usd, pricing_source, token_source, tenant_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)', [
            record.serverName,
            record.toolName,
            record.requestTokens,
            record.responseTokens,
            record.totalTokens,
            record.durationMs,
            Boolean(record.blocked),
            record.blockRule ?? null,
            encryptField(record.blockReason ?? null),
            encryptAuditArgsField(record.argumentSnippet ?? null),
            record.model ?? null,
            record.costUsd ?? null,
            record.pricingSource ?? null,
            record.tokenSource ?? null,
            tid,
        ]);
    }
    async getCallRecordsForServer(serverName, _limit, tenantId) {
        const result = tenantId
            ? await this.tenantQuery(tenantId, 'SELECT server_name, tool_name, request_tokens, response_tokens, total_tokens, duration_ms, timestamp::text, blocked, block_rule, block_reason, model, cost_usd, pricing_source, token_source, tenant_id FROM call_records WHERE server_name = $1 AND tenant_id = $2', [serverName, tenantId])
            : await this.pool.query('SELECT server_name, tool_name, request_tokens, response_tokens, total_tokens, duration_ms, timestamp::text, blocked, block_rule, block_reason, model, cost_usd, pricing_source, token_source, tenant_id FROM call_records WHERE server_name = $1', [serverName]);
        return result.rows.map((row) => ({
            serverName: row.server_name,
            toolName: row.tool_name,
            requestTokens: row.request_tokens,
            responseTokens: row.response_tokens,
            totalTokens: row.total_tokens,
            durationMs: row.duration_ms,
            timestamp: row.timestamp,
            model: row.model ?? undefined,
            costUsd: row.cost_usd != null ? Number(row.cost_usd) : undefined,
            pricingSource: row.pricing_source ?? undefined,
            blocked: Boolean(row.blocked),
            blockRule: row.block_rule ?? undefined,
            blockReason: decryptField(row.block_reason ?? null) ?? undefined,
            tokenSource: row.token_source === 'api' || row.token_source === 'estimated'
                ? row.token_source
                : undefined,
            tenantId: row.tenant_id ?? 'default',
        }));
    }
    async transaction(fn) {
        const result = fn();
        if (!(result instanceof Promise)) {
            return result;
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const asyncResult = await result;
            await client.query('COMMIT');
            return asyncResult;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    /** @deprecated Use transaction(fn: () => Promise<T>) — pool client is internal. */
    async withTransactionClient(fn) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    async flush() {
        // PostgreSQL auto-commits — no flush needed
    }
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.initialized = false;
        }
    }
}
//# sourceMappingURL=postgres-db.js.map
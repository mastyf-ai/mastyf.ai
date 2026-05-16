/**
 * PostgreSQL implementation of IDatabase for horizontal scaling.
 * Uses connection pool for production workloads.
 * Enable with: DB_TYPE=postgres DATABASE_URL=postgresql://user:pass@host:5432/db
 */
import { ProxyCallRecord } from '../types.js';
import { IDatabase } from './database-interface.js';
import { Logger } from '../utils/logger.js';
import { loadPg, type PgPoolType } from './pg-loader.js';

export class PostgresDatabase implements IDatabase {
  private pool!: PgPoolType;
  private initialized = false;
  private connectionString: string;

  constructor() {
    this.connectionString = process.env['DATABASE_URL'] || 'postgresql://localhost:5432/mcp_guardian';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const { Pool } = await loadPg();
    this.pool = new Pool({
      connectionString: this.connectionString,
      max: 10,
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

      // Run unified aggregation migration
      const { readFileSync } = await import('fs');
      const { resolve, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const migrationPath = resolve(__dirname, 'migrations', '002-unified-aggregation.sql');
      try {
        const migrationSql = readFileSync(migrationPath, 'utf-8');
        await client.query(migrationSql);
        Logger.info('PostgreSQL unified aggregation schema applied');
      } catch (migErr: any) {
        // PostgreSQL error code 42P07 = "duplicate_table" (relation already exists)
        if (migErr?.code === '42P07') {
          Logger.debug('PostgreSQL aggregation migration already applied');
        } else {
          Logger.error(`PostgreSQL aggregation migration failed: ${migErr?.message}`);
          throw migErr;
        }
      }

      this.initialized = true;
      Logger.info('PostgreSQL database initialized');
    } finally {
      client.release();
    }
  }

  async getRecentSuccessRate(serverName: string): Promise<number | null> {
    const result = await this.pool.query(
      `SELECT AVG(success) as avg FROM (
         SELECT success FROM health_checks
         WHERE server_name = $1
         ORDER BY timestamp DESC
         LIMIT 10
       ) AS recent`,
      [serverName]
    );
    if (result.rows.length > 0 && result.rows[0].avg !== null) {
      return Number(result.rows[0].avg);
    }
    return null;
  }

  async addSecurityScan(serverName: string, score: number, cveCount: number, details: unknown): Promise<void> {
    await this.pool.query(
      'INSERT INTO security_scans (server_name, score, cve_count, details) VALUES ($1, $2, $3, $4)',
      [serverName, score, cveCount, JSON.stringify(details)]
    );
  }

  async getLatestSecurityScan(serverName: string): Promise<unknown | null> {
    const result = await this.pool.query(
      'SELECT * FROM security_scans WHERE server_name = $1 ORDER BY id DESC LIMIT 1',
      [serverName]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  async getDistinctScannedServers(): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT DISTINCT server_name FROM security_scans ORDER BY server_name'
    );
    return result.rows.map((r: any) => r.server_name);
  }

  async getDistinctActiveServers(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT server_name FROM (
         SELECT server_name FROM security_scans
         UNION
         SELECT server_name FROM call_records
       ) AS active ORDER BY server_name`,
    );
    return result.rows.map((r: { server_name: string }) => r.server_name);
  }

  async addCostRecord(serverName: string, tokens: number, cost: number): Promise<void> {
    await this.pool.query(
      'INSERT INTO cost_records (server_name, tokens_used, cost_usd) VALUES ($1, $2, $3)',
      [serverName, tokens, cost]
    );
  }

  async addHealthCheck(serverName: string, latency: number, success: boolean, toolCount: number): Promise<void> {
    await this.pool.query(
      'INSERT INTO health_checks (server_name, latency_ms, success, tool_count) VALUES ($1, $2, $3, $4)',
      [serverName, latency, success ? 1 : 0, toolCount]
    );
  }

  async addCallRecord(record: ProxyCallRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO call_records (server_name, tool_name, request_tokens, response_tokens, total_tokens, duration_ms, blocked, block_rule, block_reason, model, cost_usd, pricing_source, token_source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      [
        record.serverName,
        record.toolName,
        record.requestTokens,
        record.responseTokens,
        record.totalTokens,
        record.durationMs,
        Boolean(record.blocked),
        record.blockRule ?? null,
        record.blockReason ?? null,
        record.model ?? null,
        record.costUsd ?? null,
        record.pricingSource ?? null,
        record.tokenSource ?? null,
      ]
    );
  }

  async getCallRecordsForServer(serverName: string): Promise<ProxyCallRecord[]> {
    const result = await this.pool.query(
      'SELECT server_name, tool_name, request_tokens, response_tokens, total_tokens, duration_ms, timestamp::text, blocked, block_rule, block_reason, model, cost_usd, pricing_source, token_source FROM call_records WHERE server_name = $1',
      [serverName]
    );
    return result.rows.map((row: any) => ({
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
      blockReason: row.block_reason ?? undefined,
      tokenSource: row.token_source === 'api' || row.token_source === 'estimated'
        ? row.token_source
        : undefined,
    }));
  }

  async transaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async flush(): Promise<void> {
    // PostgreSQL auto-commits — no flush needed
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.initialized = false;
    }
  }
}
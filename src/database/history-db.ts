/**
 * MCP Guardian History Database — better-sqlite3 with WAL mode.
 *
 * Replaces the original sql.js (WASM/in-memory) implementation with a
 * synchronous, disk-backed, WAL-mode SQLite database that survives crashes,
 * supports concurrent reads during writes, and has zero in-memory overhead.
 *
 * Fix 1 from the Production Readiness Audit (Part 7 — Remediation Blueprint).
 * v2.3.24: Replaced proper-lockfile with simple PID-based lock to eliminate stale lock issues.
 *
 * Secondary writers: set `MCP_GUARDIAN_DB_PATH` to the same file on the host;
 * WAL mode + busy_timeout=5000 allow concurrent proxy/TUI access.
 */
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { resolveGuardianDbPath } from '../utils/guardian-db-path.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'fs';
import { Logger } from '../utils/logger.js';
import { ProxyCallRecord } from '../types.js';
import { IDatabase } from './database-interface.js';
import { monitorDbQuery } from '../utils/db-performance-monitor.js';
import {
  decryptAuditArgsField,
  decryptField,
  encryptAuditArgsField,
  encryptField,
  getFieldEncryptionKey,
} from '../utils/field-encryption.js';
import { applyIndustryStandardMigration } from './industry-standard-store.js';

/** Configurable audit retention (default 30 days). */
export function resolveRetentionDays(): number {
  const raw = process.env['MCP_GUARDIAN_RETENTION_DAYS'];
  if (raw === undefined || raw === '') return 30;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 30;
  return Math.min(3650, Math.max(1, n));
}

export interface SecurityRecord {
  id: number;
  server_name: string;
  score: number;
  cves_found: number;
  details: string;
  created_at: string;
}

export interface CostRecord {
  id: number;
  server_name: string;
  tokens_used: number;
  estimated_cost_usd: number;
  tokenizer_provider?: string;
  is_estimate?: number;
  created_at: string;
}

export interface HealthRecord {
  id: number;
  server_name: string;
  latency_ms: number;
  success: number;
  tool_count: number;
  created_at: string;
}

/**
 * Simple PID-based file lock — replaces proper-lockfile.
 * Writes PID to a .pid file. On construction, checks if another process
 * holds the lock (via kill(pid, 0)). If stale, cleans up and re-acquires.
 */
export interface HistoryDatabaseOptions {
  /** Share the canonical DB read-only while another process holds the write lock (TUI, doctor). */
  readOnly?: boolean;
}

function acquireLock(
  dbPath: string,
  readOnly = false,
): { lockPath: string; cleanup: () => void; dbPath: string; readOnly: boolean; secondaryWriter: boolean } {
  const lockPath = dbPath + '.pid';

  // Try to read existing PID
  if (existsSync(lockPath)) {
    try {
      const existingPid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
      if (!isNaN(existingPid) && existingPid > 0) {
        // Check if process is still alive
        let alive = false;
        try {
          process.kill(existingPid, 0);
          alive = true;
        } catch {
          // Process does not exist — stale lock
        }
        if (alive && existingPid !== process.pid) {
          if (readOnly) {
            Logger.info(
              `[HistoryDb] Opening ${dbPath} read-only (writer PID ${existingPid})`,
            );
            return { lockPath: '', cleanup: () => {}, dbPath, readOnly: true, secondaryWriter: false };
          }
          // Share canonical DB via WAL + busy_timeout (TUI/demo/proxy observe same file)
          Logger.info(
            `[HistoryDb] Opening ${dbPath} as secondary writer (primary PID ${existingPid})`,
          );
          return { lockPath: '', cleanup: () => {}, dbPath, readOnly: false, secondaryWriter: true };
        }
        if (!alive) {
          Logger.info(`[HistoryDb] Removed stale lock for ${dbPath} (PID ${existingPid} not running)`);
        }
      }
    } catch {
      // Corrupt lock file — clean up
    }
    // Clean stale lock
    try { unlinkSync(lockPath); } catch {}
    // Also clean any leftover directory lock from proper-lockfile
    const oldLockDir = dbPath + '.lock';
    try {
      if (existsSync(oldLockDir)) rmSync(oldLockDir, { recursive: true, force: true });
    } catch {}
  }

  // Acquire lock
  writeFileSync(lockPath, String(process.pid));

  return {
    lockPath,
    dbPath,
    readOnly: false,
    secondaryWriter: false,
    cleanup: () => {
      try { if (existsSync(lockPath)) unlinkSync(lockPath); } catch {}
    },
  };
}

export class HistoryDatabase implements IDatabase {
  private db: Database.Database;
  private dbPath: string;
  private readonly openedReadOnly: boolean;
  private lockCleanup: (() => void) | null = null;
  private PURGE_TTL_DAYS = resolveRetentionDays();
  private purgeInterval: ReturnType<typeof setInterval> | null = null;

  constructor(dbPathOrMemory?: string, options?: HistoryDatabaseOptions) {
    // :memory: support is retained for tests
    if (dbPathOrMemory === ':memory:') {
      this.dbPath = ':memory:';
      this.openedReadOnly = false;
      this.db = new Database(':memory:');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('foreign_keys = ON');
      this.applySqlCipherKeyIfConfigured();
      this.migrate();
      Logger.info(`[HistoryDb] Opened in-memory database`);
      return;
    }

    const requestedPath = resolveGuardianDbPath(dbPathOrMemory);
    const dir = dirname(requestedPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const readOnly = options?.readOnly === true;
    const { cleanup, dbPath: effectivePath, readOnly: openedReadOnly, secondaryWriter } =
      acquireLock(requestedPath, readOnly);
    this.dbPath = effectivePath;
    this.openedReadOnly = openedReadOnly;

    if (!openedReadOnly && !secondaryWriter) {
      this.lockCleanup = cleanup;
      if (!existsSync(this.dbPath)) {
        writeFileSync(this.dbPath, '');
      }
    } else if (secondaryWriter) {
      if (!existsSync(this.dbPath)) {
        throw new Error(`[HistoryDb] Cannot open secondary writer — ${this.dbPath} does not exist`);
      }
    }

    this.db = openedReadOnly
      ? new Database(this.dbPath, { readonly: true, fileMustExist: true })
      : new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    if (!openedReadOnly) {
      this.db.pragma('synchronous = NORMAL');
    }
    this.db.pragma('foreign_keys = ON');
    this.applySqlCipherKeyIfConfigured();

    if (!openedReadOnly) {
      this.migrate();
      this.startPurgeInterval();
    }
    Logger.info(
      `[HistoryDb] Opened: ${this.dbPath} (${openedReadOnly ? 'read-only, ' : ''}WAL mode, PID ${process.pid})`,
    );
  }

  async initialize(): Promise<void> {
    // Database is already initialised in constructor
  }

  getDbPath(): string {
    return this.dbPath;
  }

  isReadOnly(): boolean {
    return this.openedReadOnly;
  }

  /** Synchronous SQL exec — used by IndustryStandardStore migrations and CRUD. */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** Prepared statement — delegates to better-sqlite3 for IndustryStandardStore. */
  prepare(sql: string): ReturnType<Database.Database['prepare']> {
    return this.db.prepare(sql);
  }

  /** SQLCipher PRAGMA key when GUARDIAN_DB_ENCRYPTION_KEY is set (requires sqlcipher-enabled build). */
  private applySqlCipherKeyIfConfigured(): void {
    const key = getFieldEncryptionKey();
    if (!key || this.dbPath === ':memory:') return;
    try {
      this.db.pragma(`key = '${key.replace(/'/g, "''")}'`);
      Logger.info('[HistoryDb] SQLCipher key applied (PRAGMA key)');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.warn(`[HistoryDb] SQLCipher PRAGMA key not supported — use field encryption or LUKS: ${msg}`);
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_scans (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        server_name TEXT    NOT NULL,
        score       REAL    NOT NULL,
        cves_found  INTEGER DEFAULT 0,
        details     TEXT,
        created_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS cost_records (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        server_name        TEXT    NOT NULL,
        tokens_used        INTEGER NOT NULL,
        estimated_cost_usd REAL    NOT NULL,
        tokenizer_provider TEXT,
        is_estimate        INTEGER DEFAULT 0,
        created_at         TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS health_checks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        server_name TEXT    NOT NULL,
        latency_ms  REAL    NOT NULL,
        success     INTEGER DEFAULT 1,
        tool_count  INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS call_records (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        server_name     TEXT    NOT NULL,
        tool_name       TEXT    NOT NULL,
        request_tokens  INTEGER NOT NULL,
        response_tokens INTEGER NOT NULL,
        total_tokens    INTEGER NOT NULL,
        duration_ms     INTEGER NOT NULL,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_call_records_server
        ON call_records(server_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_security_scans_server
        ON security_scans(server_name, created_at DESC);
    `);
    this.migrateCallRecordsColumns();
    this.migrateTenantAuditColumns();
    this.migrateQueryIndexes();
    applyIndustryStandardMigration(this as unknown as import('./database-interface.js').IDatabase);
  }

  private migrateQueryIndexes(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_call_records_tenant_ts
        ON call_records(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_call_records_server_ts
        ON call_records(server_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cost_records_tenant_ts
        ON cost_records(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cost_records_server_ts
        ON cost_records(server_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_security_scans_tenant_ts
        ON security_scans(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_security_scans_server_ts
        ON security_scans(server_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_health_checks_tenant_ts
        ON health_checks(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_health_checks_server_ts
        ON health_checks(server_name, created_at DESC);
    `);
  }

  private migrateTenantAuditColumns(): void {
    for (const table of ['cost_records', 'security_scans', 'health_checks'] as const) {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      const names = new Set(cols.map((c) => c.name));
      if (!names.has('tenant_id')) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`);
        this.db.exec(
          `CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id, created_at DESC)`,
        );
      }
    }
  }

  private migrateCallRecordsColumns(): void {
    const cols = this.db.prepare('PRAGMA table_info(call_records)').all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('blocked')) {
      this.db.exec('ALTER TABLE call_records ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
    }
    if (!names.has('block_rule')) {
      this.db.exec('ALTER TABLE call_records ADD COLUMN block_rule TEXT');
    }
    if (!names.has('block_reason')) {
      this.db.exec('ALTER TABLE call_records ADD COLUMN block_reason TEXT');
    }
    if (!names.has('model')) {
      this.db.exec('ALTER TABLE call_records ADD COLUMN model TEXT');
    }
    if (!names.has('cost_usd')) {
      this.db.exec('ALTER TABLE call_records ADD COLUMN cost_usd REAL');
    }
    if (!names.has('pricing_source')) {
      this.db.exec('ALTER TABLE call_records ADD COLUMN pricing_source TEXT');
    }
    if (!names.has('token_source')) {
      this.db.exec('ALTER TABLE call_records ADD COLUMN token_source TEXT');
    }
    if (!names.has('tenant_id')) {
      this.db.exec("ALTER TABLE call_records ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'");
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_call_records_tenant ON call_records(tenant_id, created_at DESC)');
    }
    if (!names.has('argument_snippet')) {
      this.db.exec('ALTER TABLE call_records ADD COLUMN argument_snippet TEXT');
    }
  }

  async addCallRecord(record: ProxyCallRecord): Promise<void> {
    monitorDbQuery('addCallRecord', () => {
    const stmt = this.db.prepare(
      'INSERT INTO call_records (server_name, tool_name, request_tokens, response_tokens, total_tokens, duration_ms, blocked, block_rule, block_reason, argument_snippet, model, cost_usd, pricing_source, token_source, tenant_id) VALUES (@serverName, @toolName, @requestTokens, @responseTokens, @totalTokens, @durationMs, @blocked, @blockRule, @blockReason, @argumentSnippet, @model, @costUsd, @pricingSource, @tokenSource, @tenantId)'
    );
    stmt.run({
      serverName: record.serverName,
      toolName: record.toolName,
      requestTokens: record.requestTokens,
      responseTokens: record.responseTokens,
      totalTokens: record.totalTokens,
      durationMs: record.durationMs,
      blocked: record.blocked ? 1 : 0,
      blockRule: record.blockRule ?? null,
      blockReason: encryptField(record.blockReason ?? null),
      argumentSnippet: encryptAuditArgsField(record.argumentSnippet ?? null),
      model: record.model ?? null,
      costUsd: record.costUsd ?? null,
      pricingSource: record.pricingSource ?? null,
      tokenSource: record.tokenSource ?? null,
      tenantId: record.tenantId ?? 'default',
    });
    });
  }

  async getCallRecordsForServer(
    serverName: string,
    limit = 1000000,
    tenantId?: string,
  ): Promise<ProxyCallRecord[]> {
    return monitorDbQuery('getCallRecordsForServer', () => {
    const rows = tenantId
      ? this.db
        .prepare('SELECT * FROM call_records WHERE server_name = ? AND tenant_id = ? ORDER BY id DESC LIMIT ?')
        .all(serverName, tenantId, limit)
      : this.db
        .prepare('SELECT * FROM call_records WHERE server_name = ? ORDER BY id DESC LIMIT ?')
        .all(serverName, limit);
    return (rows as Array<Record<string, unknown>>).map((row: any) => this.mapCallRecordRow(row));
    });
  }

  /** Incremental sync — rows with id > afterId in ascending order. */
  async getCallRecordsAfterId(
    serverName: string,
    afterId: number,
    limit: number,
    tenantId?: string,
  ): Promise<Array<ProxyCallRecord & { sourceId: number }>> {
    return monitorDbQuery('getCallRecordsAfterId', () => {
      const rows = tenantId
        ? this.db
          .prepare(
            'SELECT * FROM call_records WHERE server_name = ? AND tenant_id = ? AND id > ? ORDER BY id ASC LIMIT ?',
          )
          .all(serverName, tenantId, afterId, limit)
        : this.db
          .prepare(
            'SELECT * FROM call_records WHERE server_name = ? AND id > ? ORDER BY id ASC LIMIT ?',
          )
          .all(serverName, afterId, limit);
      return (rows as Array<Record<string, unknown>>).map((row: any) => ({
        ...this.mapCallRecordRow(row),
        sourceId: Number(row.id) || 0,
      }));
    });
  }

  private mapCallRecordRow(row: Record<string, unknown>): ProxyCallRecord {
    const r = row as any;
    return {
      serverName: r.server_name ?? '',
      toolName: r.tool_name ?? '',
      requestTokens: r.request_tokens ?? 0,
      responseTokens: r.response_tokens ?? 0,
      totalTokens: r.total_tokens ?? 0,
      durationMs: r.duration_ms ?? 0,
      timestamp: r.created_at ?? new Date().toISOString(),
      model: r.model ?? undefined,
      costUsd: r.cost_usd != null ? Number(r.cost_usd) : undefined,
      pricingSource: r.pricing_source ?? undefined,
      blocked: Boolean(r.blocked),
      blockRule: r.block_rule ?? undefined,
      blockReason: decryptField(r.block_reason ?? null) ?? undefined,
      argumentSnippet: decryptAuditArgsField(r.argument_snippet ?? null) ?? undefined,
      tokenSource: r.token_source === 'api' || r.token_source === 'estimated'
        ? r.token_source
        : undefined,
      tenantId: r.tenant_id ?? 'default',
    };
  }

  async transaction<T>(fn: () => Promise<T> | T): Promise<T> {
    const txn = this.db.transaction(() => {
      const result = fn();
      if (result instanceof Promise) {
        throw new Error('Async callbacks not supported in SQLite transactions — use synchronous operations');
      }
      return result as T;
    });
    return txn();
  }

  async flush(): Promise<void> {}

  async addSecurityScan(
    serverName: string,
    score: number,
    cvesFound: number,
    details: unknown,
    tenantId = 'default',
  ): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO security_scans (server_name, score, cves_found, details, tenant_id) VALUES (?, ?, ?, ?, ?)',
      )
      .run(serverName, score, cvesFound, JSON.stringify(details), tenantId);
  }

  async getLatestSecurityScan(serverName: string, tenantId?: string): Promise<SecurityRecord | null> {
    const row = (tenantId
      ? this.db
        .prepare(
          'SELECT * FROM security_scans WHERE server_name = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1',
        )
        .get(serverName, tenantId)
      : this.db
        .prepare('SELECT * FROM security_scans WHERE server_name = ? ORDER BY id DESC LIMIT 1')
        .get(serverName)) as SecurityRecord | undefined;
    return row ?? null;
  }

  async getSecurityScanHistory(serverName: string, limit = 10, tenantId?: string): Promise<SecurityRecord[]> {
    return (tenantId
      ? this.db
        .prepare(
          'SELECT * FROM security_scans WHERE server_name = ? AND tenant_id = ? ORDER BY id DESC LIMIT ?',
        )
        .all(serverName, tenantId, limit)
      : this.db
        .prepare('SELECT * FROM security_scans WHERE server_name = ? ORDER BY id DESC LIMIT ?')
        .all(serverName, limit)) as SecurityRecord[];
  }

  async getDistinctScannedServers(tenantId?: string): Promise<string[]> {
    const rows = (tenantId
      ? this.db.prepare(
        'SELECT DISTINCT server_name FROM security_scans WHERE tenant_id = ? ORDER BY server_name',
      ).all(tenantId)
      : this.db.prepare(
        'SELECT DISTINCT server_name FROM security_scans ORDER BY server_name',
      ).all()) as Array<{ server_name: string }>;
    return rows.map((r) => r.server_name);
  }

  async getDistinctActiveServers(tenantId?: string): Promise<string[]> {
    if (tenantId) {
      return this.getDistinctServersForTenant(tenantId);
    }
    const rows = this.db
      .prepare(
        `SELECT DISTINCT server_name FROM (
           SELECT server_name FROM security_scans
           UNION
           SELECT server_name FROM call_records
         ) ORDER BY server_name`,
      )
      .all() as Array<{ server_name: string }>;
    return rows.map((r) => r.server_name);
  }

  async addCostRecord(
    serverName: string,
    tokensUsed: number,
    estimatedCostUSD: number,
    tenantId = 'default',
  ): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO cost_records (server_name, tokens_used, estimated_cost_usd, tenant_id) VALUES (?, ?, ?, ?)',
      )
      .run(serverName, tokensUsed, estimatedCostUSD, tenantId);
  }

  async getLatestCostRecord(serverName: string, tenantId?: string): Promise<CostRecord | null> {
    const row = (tenantId
      ? this.db
        .prepare(
          'SELECT * FROM cost_records WHERE server_name = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1',
        )
        .get(serverName, tenantId)
      : this.db
        .prepare('SELECT * FROM cost_records WHERE server_name = ? ORDER BY id DESC LIMIT 1')
        .get(serverName)) as CostRecord | undefined;
    return row ?? null;
  }

  async getCostHistory(serverName: string, tenantId?: string): Promise<CostRecord[]> {
    return (tenantId
      ? this.db
        .prepare('SELECT * FROM cost_records WHERE server_name = ? AND tenant_id = ? ORDER BY id DESC')
        .all(serverName, tenantId)
      : this.db
        .prepare('SELECT * FROM cost_records WHERE server_name = ? ORDER BY id DESC')
        .all(serverName)) as CostRecord[];
  }

  async getTotalCost(serverName?: string, tenantId?: string): Promise<number | null> {
    if (serverName && tenantId) {
      const row = this.db
        .prepare(
          'SELECT SUM(estimated_cost_usd) as total FROM cost_records WHERE server_name = ? AND tenant_id = ?',
        )
        .get(serverName, tenantId) as { total: number | null } | undefined;
      return row?.total ?? null;
    }
    if (serverName) {
      const row = this.db
        .prepare('SELECT SUM(estimated_cost_usd) as total FROM cost_records WHERE server_name = ?')
        .get(serverName) as { total: number | null } | undefined;
      return row?.total ?? null;
    }
    if (tenantId) {
      const row = this.db
        .prepare('SELECT SUM(estimated_cost_usd) as total FROM cost_records WHERE tenant_id = ?')
        .get(tenantId) as { total: number | null } | undefined;
      return row?.total ?? null;
    }
    const row = this.db
      .prepare('SELECT SUM(estimated_cost_usd) as total FROM cost_records')
      .get() as { total: number | null } | undefined;
    return row?.total ?? null;
  }

  async addHealthCheck(
    serverName: string,
    latencyMs: number,
    success: boolean,
    toolCount: number,
    tenantId = 'default',
  ): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO health_checks (server_name, latency_ms, success, tool_count, tenant_id) VALUES (?, ?, ?, ?, ?)',
      )
      .run(serverName, latencyMs, success ? 1 : 0, toolCount, tenantId);
  }

  async getLatestHealthCheck(serverName: string, tenantId?: string): Promise<HealthRecord | null> {
    const row = (tenantId
      ? this.db
        .prepare(
          'SELECT * FROM health_checks WHERE server_name = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1',
        )
        .get(serverName, tenantId)
      : this.db
        .prepare('SELECT * FROM health_checks WHERE server_name = ? ORDER BY id DESC LIMIT 1')
        .get(serverName)) as HealthRecord | undefined;
    return row ?? null;
  }

  async getRecentSuccessRate(serverName: string, tenantId?: string): Promise<number | null> {
    const row = (tenantId
      ? this.db.prepare(
        `SELECT AVG(success) as avg
         FROM (
           SELECT success FROM health_checks
           WHERE server_name = ? AND tenant_id = ?
           ORDER BY id DESC
           LIMIT 10
         )`,
      ).get(serverName, tenantId)
      : this.db.prepare(
        `SELECT AVG(success) as avg
         FROM (
           SELECT success FROM health_checks
           WHERE server_name = ?
           ORDER BY id DESC
           LIMIT 10
         )`,
      ).get(serverName)) as { avg: number | null } | undefined;
    return row?.avg ?? null;
  }

  /** Distinct tenant ids present in audit tables (for PG sync). */
  getDistinctAuditTenants(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT tenant_id FROM (
           SELECT tenant_id FROM call_records
           UNION SELECT tenant_id FROM cost_records
           UNION SELECT tenant_id FROM security_scans
           UNION SELECT tenant_id FROM health_checks
         ) ORDER BY tenant_id`,
      )
      .all() as Array<{ tenant_id: string }>;
    return rows.map((r) => r.tenant_id);
  }

  /** Distinct server names for a tenant across audit tables. */
  getDistinctServersForTenant(tenantId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT server_name FROM (
           SELECT server_name FROM call_records WHERE tenant_id = ?
           UNION SELECT server_name FROM cost_records WHERE tenant_id = ?
           UNION SELECT server_name FROM security_scans WHERE tenant_id = ?
           UNION SELECT server_name FROM health_checks WHERE tenant_id = ?
         ) ORDER BY server_name`,
      )
      .all(tenantId, tenantId, tenantId, tenantId) as Array<{ server_name: string }>;
    return rows.map((r) => r.server_name);
  }

  private startPurgeInterval(): void {
    if (this.dbPath === ':memory:') return;
    this.purgeInterval = setInterval(() => {
      this.purge(this.PURGE_TTL_DAYS);
    }, 3_600_000);
  }

  purge(ttlDays: number = 30): void {
    try {
      const result = this.db
        .prepare(`DELETE FROM call_records WHERE created_at < datetime('now','-' || ? || ' days')`)
        .run(ttlDays);
      Logger.info(`[db] Purged ${result.changes} call records older than ${ttlDays} days`);
    } catch (err: any) {
      Logger.error(`[db] Purge error: ${err?.message}`);
    }
  }

  /**
   * GDPR Article 17 — erase audit data in this database file.
   * When tenantId is provided, only that tenant's rows are removed.
   */
  eraseAllAuditData(tenantId?: string): {
    callRecords: number;
    costRecords: number;
    securityScans: number;
    healthChecks: number;
  } {
    if (this.openedReadOnly) {
      throw new Error('[HistoryDb] Cannot erase audit data on a read-only connection');
    }
    const whereTenant = tenantId ? ' WHERE tenant_id = ?' : '';
    const bind = tenantId ? [tenantId] : [];
    const counts = {
      callRecords: tenantId
        ? this.db.prepare(`DELETE FROM call_records${whereTenant}`).run(...bind).changes
        : this.db.prepare('DELETE FROM call_records').run().changes,
      costRecords: tenantId
        ? this.db.prepare(`DELETE FROM cost_records${whereTenant}`).run(...bind).changes
        : this.db.prepare('DELETE FROM cost_records').run().changes,
      securityScans: tenantId
        ? this.db.prepare(`DELETE FROM security_scans${whereTenant}`).run(...bind).changes
        : this.db.prepare('DELETE FROM security_scans').run().changes,
      healthChecks: tenantId
        ? this.db.prepare(`DELETE FROM health_checks${whereTenant}`).run(...bind).changes
        : this.db.prepare('DELETE FROM health_checks').run().changes,
    };
    Logger.info(`[HistoryDb] GDPR eraseAllAuditData${tenantId ? `(tenant=${tenantId})` : ''}: ${JSON.stringify(counts)}`);
    return counts;
  }

  close(): void {
    if (this.purgeInterval) {
      clearInterval(this.purgeInterval);
      this.purgeInterval = null;
    }
    try {
      if (!this.openedReadOnly) {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
      }
      this.db.close();
      if (this.lockCleanup) this.lockCleanup();
      Logger.info(`[HistoryDb] Closed${this.openedReadOnly ? '' : ' and WAL checkpointed'}`);
    } catch (err: any) {
      Logger.error(`[HistoryDb] Error closing: ${err?.message}`);
    }
  }
}
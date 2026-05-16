/**
 * MCP Guardian History Database — better-sqlite3 with WAL mode.
 *
 * Replaces the original sql.js (WASM/in-memory) implementation with a
 * synchronous, disk-backed, WAL-mode SQLite database that survives crashes,
 * supports concurrent reads during writes, and has zero in-memory overhead.
 *
 * Fix 1 from the Production Readiness Audit (Part 7 — Remediation Blueprint).
 * v2.3.24: Replaced proper-lockfile with simple PID-based lock to eliminate stale lock issues.
 */
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { resolveGuardianDbPath } from '../utils/guardian-db-path.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'fs';
import { Logger } from '../utils/logger.js';
import { ProxyCallRecord } from '../types.js';
import { IDatabase } from './database-interface.js';

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
  private PURGE_TTL_DAYS = 30;
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
  }

  async addCallRecord(record: ProxyCallRecord): Promise<void> {
    const stmt = this.db.prepare(
      'INSERT INTO call_records (server_name, tool_name, request_tokens, response_tokens, total_tokens, duration_ms, blocked, block_rule, block_reason, model, cost_usd, pricing_source, token_source) VALUES (@serverName, @toolName, @requestTokens, @responseTokens, @totalTokens, @durationMs, @blocked, @blockRule, @blockReason, @model, @costUsd, @pricingSource, @tokenSource)'
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
      blockReason: record.blockReason ?? null,
      model: record.model ?? null,
      costUsd: record.costUsd ?? null,
      pricingSource: record.pricingSource ?? null,
      tokenSource: record.tokenSource ?? null,
    });
  }

  async getCallRecordsForServer(serverName: string, limit = 5000): Promise<ProxyCallRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM call_records WHERE server_name = ? ORDER BY id DESC LIMIT ?')
      .all(serverName, limit) as Array<Record<string, unknown>>;
    return rows.map((row: any) => ({
      serverName: row.server_name ?? '',
      toolName: row.tool_name ?? '',
      requestTokens: row.request_tokens ?? 0,
      responseTokens: row.response_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0,
      durationMs: row.duration_ms ?? 0,
      timestamp: row.created_at ?? new Date().toISOString(),
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

  async addSecurityScan(serverName: string, score: number, cvesFound: number, details: unknown): Promise<void> {
    this.db
      .prepare('INSERT INTO security_scans (server_name, score, cves_found, details) VALUES (?, ?, ?, ?)')
      .run(serverName, score, cvesFound, JSON.stringify(details));
  }

  async getLatestSecurityScan(serverName: string): Promise<SecurityRecord | null> {
    return (
      (this.db
        .prepare('SELECT * FROM security_scans WHERE server_name = ? ORDER BY id DESC LIMIT 1')
        .get(serverName) as SecurityRecord | undefined) ?? null
    );
  }

  async getSecurityScanHistory(serverName: string, limit = 10): Promise<SecurityRecord[]> {
    return this.db
      .prepare('SELECT * FROM security_scans WHERE server_name = ? ORDER BY id DESC LIMIT ?')
      .all(serverName, limit) as SecurityRecord[];
  }

  async getDistinctScannedServers(): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT DISTINCT server_name FROM security_scans ORDER BY server_name')
      .all() as Array<{ server_name: string }>;
    return rows.map((r) => r.server_name);
  }

  async getDistinctActiveServers(): Promise<string[]> {
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

  async addCostRecord(serverName: string, tokensUsed: number, estimatedCostUSD: number): Promise<void> {
    this.db
      .prepare('INSERT INTO cost_records (server_name, tokens_used, estimated_cost_usd) VALUES (?, ?, ?)')
      .run(serverName, tokensUsed, estimatedCostUSD);
  }

  async getLatestCostRecord(serverName: string): Promise<CostRecord | null> {
    return (
      (this.db
        .prepare('SELECT * FROM cost_records WHERE server_name = ? ORDER BY id DESC LIMIT 1')
        .get(serverName) as CostRecord | undefined) ?? null
    );
  }

  async getCostHistory(serverName: string): Promise<CostRecord[]> {
    return this.db
      .prepare('SELECT * FROM cost_records WHERE server_name = ? ORDER BY id DESC')
      .all(serverName) as CostRecord[];
  }

  async getTotalCost(serverName?: string): Promise<number | null> {
    if (serverName) {
      const row = this.db
        .prepare('SELECT SUM(estimated_cost_usd) as total FROM cost_records WHERE server_name = ?')
        .get(serverName) as { total: number | null } | undefined;
      return row?.total ?? null;
    }
    const row = this.db
      .prepare('SELECT SUM(estimated_cost_usd) as total FROM cost_records')
      .get() as { total: number | null } | undefined;
    return row?.total ?? null;
  }

  async addHealthCheck(serverName: string, latencyMs: number, success: boolean, toolCount: number): Promise<void> {
    this.db
      .prepare('INSERT INTO health_checks (server_name, latency_ms, success, tool_count) VALUES (?, ?, ?, ?)')
      .run(serverName, latencyMs, success ? 1 : 0, toolCount);
  }

  async getLatestHealthCheck(serverName: string): Promise<HealthRecord | null> {
    return (
      (this.db
        .prepare('SELECT * FROM health_checks WHERE server_name = ? ORDER BY id DESC LIMIT 1')
        .get(serverName) as HealthRecord | undefined) ?? null
    );
  }

  async getRecentSuccessRate(serverName: string): Promise<number | null> {
    const row = this.db
      .prepare(
        `SELECT AVG(success) as avg
         FROM (
           SELECT success FROM health_checks
           WHERE server_name = ?
           ORDER BY id DESC
           LIMIT 10
         )`
      )
      .get(serverName) as { avg: number | null } | undefined;
    return row?.avg ?? null;
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
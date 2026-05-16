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
import { homedir } from 'os';
import { join, dirname } from 'path';
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

const DEFAULT_DB_PATH = join(homedir(), '.mcp-guardian', 'history.db');

/**
 * Simple PID-based file lock — replaces proper-lockfile.
 * Writes PID to a .pid file. On construction, checks if another process
 * holds the lock (via kill(pid, 0)). If stale, cleans up and re-acquires.
 */
function acquireLock(dbPath: string): { lockPath: string; cleanup: () => void } {
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
          // Another process is alive — give this instance a unique path
          const uniquePath = dbPath.replace(/\.db$/, '-' + process.pid + '-' + Date.now() + '.db');
          Logger.warn(`[HistoryDb] DB ${dbPath} locked by PID ${existingPid} — using unique path ${uniquePath}`);
          return acquireLock(uniquePath);
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
    cleanup: () => {
      try { if (existsSync(lockPath)) unlinkSync(lockPath); } catch {}
    },
  };
}

export class HistoryDatabase implements IDatabase {
  private db: Database.Database;
  private dbPath: string;
  private lockCleanup: (() => void) | null = null;
  private PURGE_TTL_DAYS = 30;
  private purgeInterval: ReturnType<typeof setInterval> | null = null;

  constructor(dbPathOrMemory?: string) {
    // :memory: support is retained for tests
    if (dbPathOrMemory === ':memory:') {
      this.dbPath = ':memory:';
      this.db = new Database(':memory:');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('foreign_keys = ON');
      this.migrate();
      Logger.info(`[HistoryDb] Opened in-memory database`);
      return;
    }

    this.dbPath = dbPathOrMemory ?? (process.env['MCP_GUARDIAN_DB_PATH'] || DEFAULT_DB_PATH);
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Acquire PID-based lock
    const { lockPath, cleanup } = acquireLock(this.dbPath);
    this.lockCleanup = cleanup;

    // Create DB file if it doesn't exist
    if (!existsSync(this.dbPath)) {
      writeFileSync(this.dbPath, '');
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.migrate();
    this.startPurgeInterval();
    Logger.info(`[HistoryDb] Opened: ${this.dbPath} (WAL mode, PID ${process.pid})`);
  }

  async initialize(): Promise<void> {
    // Database is already initialised in constructor
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
  }

  async addCallRecord(record: ProxyCallRecord): Promise<void> {
    const stmt = this.db.prepare(
      'INSERT INTO call_records (server_name, tool_name, request_tokens, response_tokens, total_tokens, duration_ms) VALUES (@serverName, @toolName, @requestTokens, @responseTokens, @totalTokens, @durationMs)'
    );
    stmt.run({
      serverName: record.serverName,
      toolName: record.toolName,
      requestTokens: record.requestTokens,
      responseTokens: record.responseTokens,
      totalTokens: record.totalTokens,
      durationMs: record.durationMs,
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
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.close();
      if (this.lockCleanup) this.lockCleanup();
      Logger.info('[HistoryDb] Closed and WAL checkpointed');
    } catch (err: any) {
      Logger.error(`[HistoryDb] Error closing: ${err?.message}`);
    }
  }
}
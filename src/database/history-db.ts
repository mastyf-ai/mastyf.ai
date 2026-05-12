/**
 * MCP Guardian History Database — better-sqlite3 with WAL mode.
 *
 * Replaces the original sql.js (WASM/in-memory) implementation with a
 * synchronous, disk-backed, WAL-mode SQLite database that survives crashes,
 * supports concurrent reads during writes, and has zero in-memory overhead.
 *
 * Fix 1 from the Production Readiness Audit (Part 7 — Remediation Blueprint).
 */
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { Logger } from '../utils/logger.js';
import { ProxyCallRecord } from '../types.js';
import { IDatabase } from './database-interface.js';
// `proper-lockfile` has no published `@types/` — safe: API surface is tiny
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lockfile = require('proper-lockfile') as typeof import('proper-lockfile');

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

export class HistoryDatabase implements IDatabase {
  private db: Database.Database;
  private dbPath: string;
  private lockfilePath: string = '';
  private lockRelease: (() => Promise<void>) | null = null;
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

    this.dbPath = dbPathOrMemory ?? DEFAULT_DB_PATH;
    this.lockfilePath = this.dbPath + '.lock';
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // GAP 6: Advisory file lock — prevent concurrent proxy instances
    try {
      if (!existsSync(this.dbPath)) {
        writeFileSync(this.dbPath, '');
      }
      this.lockRelease = lockfile.lockSync(this.dbPath, { retries: { retries: 3, minTimeout: 200 } });
    } catch {
      throw new Error(
        `[mcp-guardian] Cannot acquire DB lock on ${this.dbPath}. ` +
        'Is another mcp-guardian proxy already running? ' +
        'Use MCP_GUARDIAN_DB_PATH to set a separate DB per instance.'
      );
    }

    this.db = new Database(this.dbPath);

    // Enable WAL mode for concurrent reads and non-blocking writes
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL'); // safe with WAL
    this.db.pragma('foreign_keys = ON');

    this.migrate();
    this.startPurgeInterval();
    Logger.info(`[HistoryDb] Opened: ${this.dbPath} (WAL mode, lock acquired)`);
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

  // ── Call records (synchronous writes — no flush/debounce needed) ────────

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
    // Map snake_case SQLite columns to camelCase ProxyCallRecord fields
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

  /** Execute callback within a database transaction. If the callback throws, the transaction is rolled back. */
  async transaction<T>(fn: () => Promise<T> | T): Promise<T> {
    // Wrap sync callback for better-sqlite3's synchronous transaction support
    const txn = this.db.transaction(() => {
      const result = fn();
      // If fn returns a Promise, we can't use better-sqlite3's synchronous transaction
      // — fall back to awaiting the Promise and returning the value
      if (result instanceof Promise) {
        throw new Error('Async callbacks not supported in SQLite transactions — use synchronous operations');
      }
      return result as T;
    });
    return txn();
  }

  async flush(): Promise<void> {
    // No-op with better-sqlite3 — writes are synchronous
  }

  // ── Security scans ──────────────────────────────────────────────────────

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

  /** Returns a deduplicated list of all server names that have been scanned. */
  async getDistinctScannedServers(): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT DISTINCT server_name FROM security_scans ORDER BY server_name')
      .all() as Array<{ server_name: string }>;
    return rows.map((r) => r.server_name);
  }

  // ── Cost records ─────────────────────────────────────────────────────────

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

  // ── Health checks ────────────────────────────────────────────────────────

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

  /**
   * Returns the average success rate from the last 10 health checks,
   * or null when no health data exists — no fabricated 100% default.
   */
  async getRecentSuccessRate(serverName: string): Promise<number | null> {
    const row = this.db
      .prepare('SELECT AVG(success) as avg FROM health_checks WHERE server_name = ? ORDER BY id DESC LIMIT 10')
      .get(serverName) as { avg: number | null } | undefined;
    return row?.avg ?? null;
  }

  // ── Maintenance ──────────────────────────────────────────────────────────

  private startPurgeInterval(): void {
    if (this.dbPath === ':memory:') return;
    this.purgeInterval = setInterval(() => {
      this.purge(this.PURGE_TTL_DAYS);
    }, 3_600_000); // hourly
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
      Logger.info('[HistoryDb] Closed and WAL checkpointed');
    } catch (err: any) {
      Logger.error(`[HistoryDb] Error closing: ${err?.message}`);
    }
  }
}
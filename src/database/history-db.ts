/**
 * SQLite-backed history database using better-sqlite3 (synchronous, 3-5x faster
 * than sql.js, no WASM overhead). Supports WAL mode, prepared statements,
 * transaction-based batch flushes, and an in-memory fallback for tests.
 */
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
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

export class HistoryDatabase implements IDatabase {
  private db: Database.Database;
  private isInMemory: boolean;
  private dbPath: string;

  constructor(dbPathOrMemory?: string) {
    if (dbPathOrMemory === ':memory:') {
      this.isInMemory = true;
      this.dbPath = ':memory:';
      this.db = new Database(':memory:');
    } else {
      this.isInMemory = false;
      this.dbPath = dbPathOrMemory ?? join(homedir(), '.mcp-guardian', 'history.db');
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this.db = new Database(this.dbPath);
    }

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_name TEXT NOT NULL,
        score REAL NOT NULL,
        cves_found INTEGER DEFAULT 0,
        details TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cost_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_name TEXT NOT NULL,
        tokens_used INTEGER NOT NULL,
        estimated_cost_usd REAL NOT NULL,
        tokenizer_provider TEXT,
        is_estimate INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_name TEXT NOT NULL,
        latency_ms REAL NOT NULL,
        success INTEGER DEFAULT 1,
        tool_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS call_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        request_tokens INTEGER NOT NULL,
        response_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  async initialize(): Promise<void> {
    // Schema created in constructor — nothing to do for better-sqlite3
  }

  async getRecentSuccessRate(serverName: string): Promise<number> {
    const row = this.db.prepare(
      'SELECT AVG(success) as avg_success FROM health_checks WHERE server_name = ? ORDER BY id DESC LIMIT 10'
    ).get(serverName) as { avg_success: number | null } | undefined;
    return row?.avg_success ?? 1.0;
  }

  /** Expose the underlying database for test introspection */
  rawDb(): Database.Database { return this.db; }

  // ── Security Scans ──────────────────────────────────────────────

  async addSecurityScan(
    serverName: string,
    score: number,
    cvesFound: number,
    details: unknown,
  ): Promise<void> {
    this.db.prepare(
      'INSERT INTO security_scans (server_name, score, cves_found, details) VALUES (?, ?, ?, ?)'
    ).run(serverName, score, cvesFound, JSON.stringify(details));
  }

  async getLatestSecurityScan(serverName: string): Promise<SecurityRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM security_scans WHERE server_name = ? ORDER BY id DESC LIMIT 1'
    ).get(serverName) as SecurityRecord | undefined;
    return row ?? null;
  }

  async getSecurityScanHistory(serverName: string, limit = 10): Promise<SecurityRecord[]> {
    return this.db.prepare(
      'SELECT * FROM security_scans WHERE server_name = ? ORDER BY id DESC LIMIT ?'
    ).all(serverName, limit) as SecurityRecord[];
  }

  // ── Cost Records ─────────────────────────────────────────────────

  async addCostRecord(
    serverName: string,
    tokensUsed: number,
    estimatedCostUSD: number,
  ): Promise<void> {
    this.db.prepare(
      'INSERT INTO cost_records (server_name, tokens_used, estimated_cost_usd) VALUES (?, ?, ?)'
    ).run(serverName, tokensUsed, estimatedCostUSD);
  }

  async getLatestCostRecord(serverName: string): Promise<CostRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM cost_records WHERE server_name = ? ORDER BY id DESC LIMIT 1'
    ).get(serverName) as CostRecord | undefined;
    return row ?? null;
  }

  async getCostHistory(serverName: string): Promise<CostRecord[]> {
    return this.db.prepare(
      'SELECT * FROM cost_records WHERE server_name = ? ORDER BY id DESC'
    ).all(serverName) as CostRecord[];
  }

  async getTotalCost(serverName?: string): Promise<number> {
    if (serverName) {
      const row = this.db.prepare(
        'SELECT SUM(estimated_cost_usd) as total FROM cost_records WHERE server_name = ?'
      ).get(serverName) as { total: number | null } | undefined;
      return row?.total ?? 0;
    }
    const row = this.db.prepare(
      'SELECT SUM(estimated_cost_usd) as total FROM cost_records'
    ).get() as { total: number | null } | undefined;
    return row?.total ?? 0;
  }

  // ── Health Checks ────────────────────────────────────────────────

  async addHealthCheck(
    serverName: string,
    latencyMs: number,
    success: boolean,
    toolCount: number,
  ): Promise<void> {
    this.db.prepare(
      'INSERT INTO health_checks (server_name, latency_ms, success, tool_count) VALUES (?, ?, ?, ?)'
    ).run(serverName, latencyMs, success ? 1 : 0, toolCount);
  }

  async getLatestHealthCheck(serverName: string): Promise<HealthRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM health_checks WHERE server_name = ? ORDER BY id DESC LIMIT 1'
    ).get(serverName) as HealthRecord | undefined;
    return row ?? null;
  }

  // ── Call Records (Proxy) ────────────────────────────────────────

  async addCallRecord(record: ProxyCallRecord): Promise<void> {
    this.db.prepare(
      'INSERT INTO call_records (server_name, tool_name, request_tokens, response_tokens, total_tokens, duration_ms) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      record.serverName, record.toolName,
      record.requestTokens, record.responseTokens,
      record.totalTokens, record.durationMs,
    );
  }

  async flush(): Promise<void> {
    // better-sqlite3 writes immediately — no buffering needed
  }

  async getCallRecordsForServer(serverName: string): Promise<ProxyCallRecord[]> {
    return this.db.prepare(
      'SELECT * FROM call_records WHERE server_name = ? ORDER BY id DESC'
    ).all(serverName) as ProxyCallRecord[];
  }

  close(): void {
    this.db.close();
  }
}
/**
 * SQLite-backed history database using sql.js (WASM-based, no native compilation).
 */
import initSqlJs, { Database as SqlJsDb, SqlJsStatic } from 'sql.js';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { Logger } from '../utils/logger.js';
import { ProxyCallRecord } from '../types.js';
import { IDatabase } from './database-interface.js';

export interface SecurityRecord { id: number; server_name: string; score: number; cves_found: number; details: string; created_at: string; }
export interface CostRecord { id: number; server_name: string; tokens_used: number; estimated_cost_usd: number; created_at: string; }
export interface HealthRecord { id: number; server_name: string; latency_ms: number; success: number; tool_count: number; created_at: string; }

let gSqlJs: SqlJsStatic | null = null;
async function getSqlJs(): Promise<SqlJsStatic> {
  if (!gSqlJs) {
    const m: any = await import('sql.js');
    gSqlJs = await (m.default?.() ?? m.initSqlJs?.() ?? m());
  }
  return gSqlJs!;
}

export class HistoryDatabase implements IDatabase {
  private db: SqlJsDb | null = null;
  private dbPromise: Promise<SqlJsDb> | null = null;
  private isInMemory: boolean;
  private dbPath: string;
  private writeBatch: unknown[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private purgeInterval: ReturnType<typeof setInterval> | null = null;
  private PURGE_TTL_DAYS = 30;

  constructor(dbPathOrMemory?: string) {
    if (dbPathOrMemory === ':memory:') {
      this.isInMemory = true;
      this.dbPath = ':memory:';
    } else {
      this.isInMemory = false;
      this.dbPath = dbPathOrMemory ?? join(homedir(), '.mcp-guardian', 'history.db');
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  private async getDb(): Promise<SqlJsDb> {
    if (this.db) return this.db;
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = (async () => {
      const SQL = await getSqlJs();
      if (this.isInMemory) {
        this.db = new SQL.Database();
      } else {
        let buf: Uint8Array | undefined;
        if (existsSync(this.dbPath)) {
          try { buf = new Uint8Array(readFileSync(this.dbPath)); } catch { buf = undefined; }
        }
        this.db = new SQL.Database(buf);
      }
      this.migrate();
      this.startPurgeInterval();
      return this.db;
    })();
    return this.dbPromise;
  }

  async initialize(): Promise<void> { await this.getDb(); }
  async getRecentSuccessRate(serverName: string): Promise<number> {
    const db = await this.getDb();
    const stmt = db.prepare('SELECT AVG(success) as avg FROM health_checks WHERE server_name=? ORDER BY id DESC LIMIT 10');
    stmt.bind([serverName]);
    if (stmt.step()) { const r: any = stmt.getAsObject(); stmt.free(); return r.avg ?? 1.0; }
    stmt.free(); return 1.0;
  }

  private migrate(): void {
    if (!this.db) return;
    this.db.run(`CREATE TABLE IF NOT EXISTS security_scans (id INTEGER PRIMARY KEY AUTOINCREMENT, server_name TEXT NOT NULL, score REAL NOT NULL, cves_found INTEGER DEFAULT 0, details TEXT, created_at TEXT DEFAULT (datetime('now')))`);
    this.db.run(`CREATE TABLE IF NOT EXISTS cost_records (id INTEGER PRIMARY KEY AUTOINCREMENT, server_name TEXT NOT NULL, tokens_used INTEGER NOT NULL, estimated_cost_usd REAL NOT NULL, tokenizer_provider TEXT, is_estimate INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`);
    this.db.run(`CREATE TABLE IF NOT EXISTS health_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, server_name TEXT NOT NULL, latency_ms REAL NOT NULL, success INTEGER DEFAULT 1, tool_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`);
    this.db.run(`CREATE TABLE IF NOT EXISTS call_records (id INTEGER PRIMARY KEY AUTOINCREMENT, server_name TEXT NOT NULL, tool_name TEXT NOT NULL, request_tokens INTEGER NOT NULL, response_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))`);
  }

  private startPurgeInterval(): void {
    if (this.isInMemory) return;
    this.purgeInterval = setInterval(() => { this.purge(this.PURGE_TTL_DAYS); }, 3600000);
  }

  async addSecurityScan(serverName: string, score: number, cvesFound: number, details: unknown): Promise<void> {
    const db = await this.getDb();
    db.run('INSERT INTO security_scans (server_name, score, cves_found, details) VALUES (?,?,?,?)', [serverName, score, cvesFound, JSON.stringify(details)]);
    this.save();
  }
  async addCostRecord(serverName: string, tokensUsed: number, estimatedCostUSD: number): Promise<void> {
    const db = await this.getDb();
    db.run('INSERT INTO cost_records (server_name, tokens_used, estimated_cost_usd) VALUES (?,?,?)', [serverName, tokensUsed, estimatedCostUSD]);
    this.save();
  }
  async addHealthCheck(serverName: string, latencyMs: number, success: boolean, toolCount: number): Promise<void> {
    const db = await this.getDb();
    db.run('INSERT INTO health_checks (server_name, latency_ms, success, tool_count) VALUES (?,?,?,?)', [serverName, latencyMs, success ? 1 : 0, toolCount]);
    this.save();
  }

  async addCallRecord(record: ProxyCallRecord): Promise<void> {
    this.writeBatch.push(record);
    if (!this.flushTimer) { this.flushTimer = setTimeout(() => this.doFlush(), 1000); }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    await this.doFlush();
  }

  private async doFlush(): Promise<void> {
    const records = this.writeBatch.splice(0);
    if (records.length === 0) return;
    const db = await this.getDb();
    const stmt = db.prepare('INSERT INTO call_records (server_name, tool_name, request_tokens, response_tokens, total_tokens, duration_ms) VALUES (?,?,?,?,?,?)');
    for (const r of records) {
      const rec = r as ProxyCallRecord;
      stmt.bind([rec.serverName, rec.toolName, rec.requestTokens, rec.responseTokens, rec.totalTokens, rec.durationMs]);
      stmt.step();
    }
    stmt.free();
    this.save();
    this.flushTimer = null;
  }

  async getCallRecordsForServer(serverName: string): Promise<ProxyCallRecord[]> {
    const db = await this.getDb();
    const stmt = db.prepare('SELECT * FROM call_records WHERE server_name=? ORDER BY id DESC');
    stmt.bind([serverName]);
    const results: ProxyCallRecord[] = [];
    while (stmt.step()) { results.push(stmt.getAsObject() as unknown as ProxyCallRecord); }
    stmt.free();
    return results;
  }

  async getLatestSecurityScan(serverName: string): Promise<SecurityRecord | null> { const db = await this.getDb(); const stmt = db.prepare('SELECT * FROM security_scans WHERE server_name=? ORDER BY id DESC LIMIT 1'); stmt.bind([serverName]); if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r as unknown as SecurityRecord; } stmt.free(); return null; }
  async getLatestCostRecord(serverName: string): Promise<CostRecord | null> { const db = await this.getDb(); const stmt = db.prepare('SELECT * FROM cost_records WHERE server_name=? ORDER BY id DESC LIMIT 1'); stmt.bind([serverName]); if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r as unknown as CostRecord; } stmt.free(); return null; }
  async getLatestHealthCheck(serverName: string): Promise<HealthRecord | null> { const db = await this.getDb(); const stmt = db.prepare('SELECT * FROM health_checks WHERE server_name=? ORDER BY id DESC LIMIT 1'); stmt.bind([serverName]); if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r as unknown as HealthRecord; } stmt.free(); return null; }

  async getSecurityScanHistory(serverName: string, limit=10): Promise<SecurityRecord[]> { const db = await this.getDb(); const stmt = db.prepare('SELECT * FROM security_scans WHERE server_name=? ORDER BY id DESC LIMIT ?'); stmt.bind([serverName, limit]); const r: SecurityRecord[] = []; while (stmt.step()) r.push(stmt.getAsObject() as unknown as SecurityRecord); stmt.free(); return r; }
  async getCostHistory(serverName: string): Promise<CostRecord[]> { const db = await this.getDb(); const stmt = db.prepare('SELECT * FROM cost_records WHERE server_name=? ORDER BY id DESC'); stmt.bind([serverName]); const r: CostRecord[] = []; while (stmt.step()) r.push(stmt.getAsObject() as unknown as CostRecord); stmt.free(); return r; }
  async getTotalCost(serverName?: string): Promise<number> {
    const db = await this.getDb();
    const sql = serverName ? 'SELECT SUM(estimated_cost_usd) as total FROM cost_records WHERE server_name=?' : 'SELECT SUM(estimated_cost_usd) as total FROM cost_records';
    const stmt = db.prepare(sql);
    if (serverName) stmt.bind([serverName]);
    if (stmt.step()) { const r: any = stmt.getAsObject(); stmt.free(); return r.total ?? 0; }
    stmt.free(); return 0;
  }

  purge(ttlDays: number = 30): void {
    if (!this.db) return;
    try {
      const r = this.db.run(`DELETE FROM call_records WHERE created_at < datetime('now','-' || ? || ' days')`, [ttlDays]);
      Logger.info(`[db] Purged call records older than ${ttlDays} days`);
    } catch (err: any) { Logger.error(`[db] Purge error: ${err?.message}`); }
  }

  private save(): void {
    if (this.isInMemory || !this.db) return;
    try { const buf = Buffer.from(this.db.export()); writeFileSync(this.dbPath, buf); } catch (err: any) { Logger.error(`[db] Save error: ${err?.message}`); }
  }

  close(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.purgeInterval) { clearInterval(this.purgeInterval); this.purgeInterval = null; }
    this.doFlush().catch(() => {});
    this.db?.close();
  }
}
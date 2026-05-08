import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

export class HistoryDatabase {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private initialized: boolean = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(os.homedir(), '.mcp-doctor', 'history.db');
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const SQL = await initSqlJs();
    // Load existing DB or create new one
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS security_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT (datetime('now')),
        server_name TEXT NOT NULL,
        score INTEGER NOT NULL,
        cve_count INTEGER NOT NULL DEFAULT 0,
        details TEXT
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS cost_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT (datetime('now')),
        server_name TEXT NOT NULL,
        tokens_used INTEGER NOT NULL,
        cost_usd REAL NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS health_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT (datetime('now')),
        server_name TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        tool_count INTEGER NOT NULL
      )
    `);

    // Create indexes
    this.db.run('CREATE INDEX IF NOT EXISTS idx_security_server ON security_scans(server_name)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_cost_server ON cost_records(server_name)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_health_server ON health_checks(server_name)');

    this.initialized = true;
  }

  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, data);
  }

  async getRecentSuccessRate(serverName: string): Promise<number> {
    await this.ensureInitialized();
    const result = this.db.exec(
      'SELECT AVG(success) as avg FROM health_checks WHERE server_name = ? ORDER BY timestamp DESC LIMIT 10',
      [serverName]
    );
    if (result.length > 0 && result[0].values.length > 0) {
      const avg = result[0].values[0][0];
      return typeof avg === 'number' ? avg : 1;
    }
    return 1;
  }

  async addSecurityScan(serverName: string, score: number, cveCount: number, details: unknown): Promise<void> {
    await this.ensureInitialized();
    this.db.run(
      'INSERT INTO security_scans (server_name, score, cve_count, details) VALUES (?, ?, ?, ?)',
      [serverName, score, cveCount, JSON.stringify(details)]
    );
    this.save();
  }

  async addCostRecord(serverName: string, tokens: number, cost: number): Promise<void> {
    await this.ensureInitialized();
    this.db.run(
      'INSERT INTO cost_records (server_name, tokens_used, cost_usd) VALUES (?, ?, ?)',
      [serverName, tokens, cost]
    );
    this.save();
  }

  async addHealthCheck(serverName: string, latency: number, success: boolean, toolCount: number): Promise<void> {
    await this.ensureInitialized();
    this.db.run(
      'INSERT INTO health_checks (server_name, latency_ms, success, tool_count) VALUES (?, ?, ?, ?)',
      [serverName, latency, success ? 1 : 0, toolCount]
    );
    this.save();
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.initialized = false;
    }
  }
}
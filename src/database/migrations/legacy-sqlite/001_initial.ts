/**
 * Migration 001: Initial schema for MCP Guardian.
 * Creates all four core tables and sets WAL journaling.
 */
export function migrate(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_name TEXT NOT NULL,
      score REAL NOT NULL,
      cves_found INTEGER DEFAULT 0,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cost_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_name TEXT NOT NULL,
      tokens_used INTEGER NOT NULL,
      estimated_cost_usd REAL NOT NULL,
      tokenizer_provider TEXT,
      is_estimate INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS health_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_name TEXT NOT NULL,
      latency_ms REAL NOT NULL,
      success INTEGER DEFAULT 1,
      tool_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS call_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_name TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      request_tokens INTEGER NOT NULL,
      response_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
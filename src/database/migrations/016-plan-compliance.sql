-- Migration 016: Plan compliance — fleet alerts, twin observations, policy drafts, observatory alerts

CREATE TABLE IF NOT EXISTS fleet_chain_alerts (
  alert_id TEXT PRIMARY KEY,
  global_session_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  confidence REAL NOT NULL,
  agents_json TEXT NOT NULL,
  servers_json TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  mitre_techniques_json TEXT,
  description TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fleet_chain_alerts_session
  ON fleet_chain_alerts(global_session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS digital_twin_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_json TEXT,
  latency_ms REAL NOT NULL,
  response_shape TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_twin_obs_server ON digital_twin_observations(server_name, recorded_at DESC);

CREATE TABLE IF NOT EXISTS policy_draft_approvals (
  request_id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  yaml TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default'
);

CREATE TABLE IF NOT EXISTS observatory_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  metric_type TEXT,
  threshold REAL,
  observed_value REAL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observatory_alerts_created ON observatory_alerts(created_at DESC);

-- Migration 013: Roadmap Phase 1 — config provenance, behavioral biometrics

CREATE TABLE IF NOT EXISTS config_provenance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_path TEXT NOT NULL,
  diff_json TEXT,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  signature TEXT,
  approval_id TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_provenance_created ON config_provenance_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provenance_resource ON config_provenance_events(resource_path, created_at DESC);

CREATE TABLE IF NOT EXISTS config_merkle_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkpoint_id TEXT NOT NULL UNIQUE,
  merkle_root TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS behavior_fingerprints (
  agent_id TEXT PRIMARY KEY,
  sample_count INTEGER NOT NULL DEFAULT 0,
  avg_inter_call_ms REAL NOT NULL DEFAULT 0,
  avg_arg_bytes REAL NOT NULL DEFAULT 0,
  tool_order_json TEXT NOT NULL DEFAULT '[]',
  arg_shape_hash TEXT NOT NULL DEFAULT '',
  tenant_id TEXT NOT NULL DEFAULT 'default',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS behavior_anomaly_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  anomaly_score REAL NOT NULL,
  reason TEXT NOT NULL,
  observation_json TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_behavior_anomaly_agent ON behavior_anomaly_events(agent_id, created_at DESC);

-- Phase 2: cross-server chains, digital twins
CREATE TABLE IF NOT EXISTS fleet_chain_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_session_id TEXT NOT NULL,
  agent_id TEXT,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  mitre_technique TEXT,
  event_type TEXT NOT NULL,
  edge_json TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fleet_chain_session ON fleet_chain_events(global_session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS digital_twin_snapshots (
  id TEXT PRIMARY KEY,
  server_name TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  latency_p50_ms REAL,
  latency_p99_ms REAL,
  response_shape_hash TEXT,
  sample_count INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_twin_server ON digital_twin_snapshots(server_name, captured_at DESC);

-- Phase 3: reputation network, observatory, insurance
CREATE TABLE IF NOT EXISTS reputation_network_entries (
  server_hash TEXT PRIMARY KEY,
  dimensions_json TEXT NOT NULL,
  consensus_score REAL NOT NULL,
  rater_count INTEGER NOT NULL DEFAULT 1,
  level TEXT NOT NULL,
  synced_at TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS observatory_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_type TEXT NOT NULL,
  metric_value REAL NOT NULL,
  dimension_json TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS insurance_risk_reports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  ale_usd REAL NOT NULL,
  exposure_score REAL NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

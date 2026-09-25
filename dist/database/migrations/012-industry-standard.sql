-- Migration 012: Industry standard tables (certifications, MTX, chains, sandbox, reputation, fuzz, compliance, benchmarks)
-- Compatible with SQLite (local) and PostgreSQL (fleet)

CREATE TABLE IF NOT EXISTS mcp_certifications (
  id TEXT PRIMARY KEY,
  server_name TEXT NOT NULL,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  level TEXT NOT NULL,
  score INTEGER NOT NULL,
  certified INTEGER NOT NULL DEFAULT 0,
  attestation_jws TEXT,
  checks_json TEXT NOT NULL DEFAULT '[]',
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_cert_server ON mcp_certifications(server_name, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_cert_package ON mcp_certifications(package_name, version);

CREATE TABLE IF NOT EXISTS mtx_signatures (
  signature_hash TEXT PRIMARY KEY,
  mtx_json TEXT NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 1,
  verified INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mtx_sync ON mtx_signatures(synced_at DESC);

CREATE TABLE IF NOT EXISTS session_chain_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  edge_json TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chain_session ON session_chain_events(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS capability_graph_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_name TEXT NOT NULL,
  source_tool TEXT NOT NULL,
  target_resource TEXT,
  edge_type TEXT NOT NULL,
  metadata_json TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cap_graph_server ON capability_graph_edges(server_name);

CREATE TABLE IF NOT EXISTS intent_bindings (
  session_id TEXT PRIMARY KEY,
  agent_id TEXT,
  declared_intent TEXT NOT NULL,
  allowed_tools_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sandbox_tier_state (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'shadow',
  rl_state_json TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sandbox_scope ON sandbox_tier_state(scope_type, scope_id);

CREATE TABLE IF NOT EXISTS agent_reputation (
  agent_id TEXT PRIMARY KEY,
  score REAL NOT NULL DEFAULT 50,
  tier TEXT NOT NULL DEFAULT 'standard',
  trend TEXT NOT NULL DEFAULT 'stable',
  events_json TEXT NOT NULL DEFAULT '[]',
  tenant_id TEXT NOT NULL DEFAULT 'default',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS protocol_fuzz_runs (
  id TEXT PRIMARY KEY,
  server_name TEXT NOT NULL,
  total INTEGER NOT NULL,
  blocked INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  bypasses_json TEXT NOT NULL DEFAULT '[]',
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incident_playbook_runs (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS compliance_control_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  framework TEXT NOT NULL,
  control_id TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_json TEXT,
  evaluated_at TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_fw_control ON compliance_control_status(framework, control_id, tenant_id);

CREATE TABLE IF NOT EXISTS benchmark_submissions (
  id TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  package_name TEXT,
  block_rate REAL NOT NULL,
  false_positive_rate REAL NOT NULL,
  p95_latency_ms REAL,
  scorecard_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default'
);

CREATE INDEX IF NOT EXISTS idx_bench_profile ON benchmark_submissions(profile, submitted_at DESC);

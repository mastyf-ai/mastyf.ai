-- Migration 011: Agentic AI tables for MCP Mastyf AI v3.4.0
-- Adds tables for all 10 agentic AI features

-- Agentic task tracking
CREATE TABLE IF NOT EXISTS agentic_tasks (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',  -- high, medium, low
  status TEXT NOT NULL DEFAULT 'queued',    -- queued, running, completed, failed, timeout
  enqueued_at TEXT NOT NULL,
  completed_at TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Agentic decision audit trail
CREATE TABLE IF NOT EXISTS agentic_decisions (
  decision_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  feature TEXT NOT NULL,
  rationale TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.0,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  suggested_action TEXT NOT NULL,
  outcome TEXT DEFAULT 'pending',  -- approved, denied, auto_applied, pending
  metadata TEXT,                   -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Threat forecasts
CREATE TABLE IF NOT EXISTS threat_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_name TEXT NOT NULL,
  current_risk INTEGER NOT NULL,
  risk_30d INTEGER NOT NULL,
  risk_90d INTEGER NOT NULL,
  risk_365d INTEGER NOT NULL,
  exploitation_probability REAL NOT NULL,
  forecast_confidence REAL NOT NULL,
  forecast_data TEXT NOT NULL,  -- JSON blob with full forecast
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Behavior observation windows
CREATE TABLE IF NOT EXISTS behavior_observations (
  window_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  total_calls INTEGER NOT NULL DEFAULT 0,
  unique_tools INTEGER NOT NULL DEFAULT 0,
  observation_data TEXT,  -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generated policies
CREATE TABLE IF NOT EXISTS policy_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_window_id TEXT NOT NULL,
  policy_yaml TEXT NOT NULL,
  confidence REAL NOT NULL,
  summary TEXT,
  suggestions TEXT,  -- JSON blob
  applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (observation_window_id) REFERENCES behavior_observations(window_id)
);

-- Drift events
CREATE TABLE IF NOT EXISTS drift_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_name TEXT NOT NULL,
  baseline_id TEXT NOT NULL,
  drift_score INTEGER NOT NULL,
  findings TEXT NOT NULL,  -- JSON blob
  recommend_rollback INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Baselines
CREATE TABLE IF NOT EXISTS behavior_baselines (
  id TEXT PRIMARY KEY,
  server_name TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  tool_schemas TEXT NOT NULL,  -- JSON blob
  performance_data TEXT NOT NULL,  -- JSON blob
  config_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Red team assessments
CREATE TABLE IF NOT EXISTS red_team_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attack_count INTEGER NOT NULL,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  block_rate REAL NOT NULL DEFAULT 0.0,
  bypasses TEXT,  -- JSON blob
  recommendations TEXT,  -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Threat mesh signatures
CREATE TABLE IF NOT EXISTS threat_signatures (
  signature_hash TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 1,
  verified INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,  -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Honeypot captures
CREATE TABLE IF NOT EXISTS honeypot_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  deployed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  captured_calls TEXT,  -- JSON blob
  alert_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trust negotiation sessions
CREATE TABLE IF NOT EXISTS trust_sessions (
  session_id TEXT PRIMARY KEY,
  remote_agent_id TEXT NOT NULL,
  remote_mastyf-ai TEXT NOT NULL,
  allowed_tools TEXT NOT NULL,  -- JSON array
  scope TEXT,  -- JSON blob
  rate_limit INTEGER NOT NULL,
  session_ttl_ms INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  call_count INTEGER NOT NULL DEFAULT 0,
  audit_trail TEXT,  -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trust registry
CREATE TABLE IF NOT EXISTS trust_registry (
  agent_id TEXT PRIMARY KEY,
  mastyf-ai_instance TEXT NOT NULL,
  capabilities TEXT NOT NULL,  -- JSON array
  attestation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Compliance evidence
CREATE TABLE IF NOT EXISTS compliance_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  framework TEXT NOT NULL,
  posture_score REAL NOT NULL,
  satisfied_controls INTEGER NOT NULL,
  total_controls INTEGER NOT NULL,
  gaps TEXT,  -- JSON blob
  evidence_bundle TEXT,  -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Supply chain verifications
CREATE TABLE IF NOT EXISTS supply_chain_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  integrity_score INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  issues TEXT,  -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt injection detection log
CREATE TABLE IF NOT EXISTS prompt_injection_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence REAL NOT NULL,
  detection_methods TEXT NOT NULL,  -- JSON array
  suspicious_args TEXT,  -- JSON array
  explanation TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agentic_tasks_status ON agentic_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agentic_decisions_feature ON agentic_decisions(feature);
CREATE INDEX IF NOT EXISTS idx_threat_forecasts_server ON threat_forecasts(server_name);
CREATE INDEX IF NOT EXISTS idx_drift_events_server ON drift_events(server_name);
CREATE INDEX IF NOT EXISTS idx_trust_sessions_active ON trust_sessions(active);
CREATE INDEX IF NOT EXISTS idx_compliance_framework ON compliance_evidence(framework);
CREATE INDEX IF NOT EXISTS idx_prompt_injection_category ON prompt_injection_log(category);
-- Phase 1: Unified Aggregation Schema
-- Aggregates data from all MCP Mastyf AI instances into a single source of truth

-- Mastyf AI instance registry
CREATE TABLE IF NOT EXISTS mastyf_ai_instances (
  id SERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL UNIQUE,
  instance_name TEXT NOT NULL,
  hostname TEXT,
  version TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'degraded', 'offline')),
  metadata JSONB DEFAULT '{}'
);

-- Aggregated metrics from Prometheus scrapes
CREATE TABLE IF NOT EXISTS aggregated_metrics (
  id SERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES mastyf_ai_instances(instance_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  total_requests BIGINT DEFAULT 0,
  blocked_requests BIGINT DEFAULT 0,
  passed_requests BIGINT DEFAULT 0,
  flagged_requests BIGINT DEFAULT 0,
  injection_detections BIGINT DEFAULT 0,
  auth_failures BIGINT DEFAULT 0,
  active_proxy_count INTEGER DEFAULT 0,
  active_session_count INTEGER DEFAULT 0,
  avg_latency_ms REAL DEFAULT 0,
  p50_latency_ms REAL DEFAULT 0,
  p95_latency_ms REAL DEFAULT 0,
  p99_latency_ms REAL DEFAULT 0,
  circuit_breaker_open INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  token_usage_total BIGINT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agg_metrics_instance ON aggregated_metrics(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_agg_metrics_ts ON aggregated_metrics(timestamp DESC);

-- Unified audit trail (all policy decisions from all instances)
CREATE TABLE IF NOT EXISTS unified_audit_trail (
  id SERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES mastyf_ai_instances(instance_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('pass', 'block', 'flag', 'error')),
  rule_name TEXT,
  reason TEXT,
  request_tokens INTEGER DEFAULT 0,
  response_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  model TEXT,
  client_ip TEXT,
  auth_success BOOLEAN,
  severity TEXT CHECK (severity IN ('info', 'warn', 'critical', 'emergency')),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_trail_instance ON unified_audit_trail(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_trail_server ON unified_audit_trail(server_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_trail_action ON unified_audit_trail(action, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_trail_severity ON unified_audit_trail(severity, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_trail_ts ON unified_audit_trail(timestamp DESC);

-- Centralized security scan results
CREATE TABLE IF NOT EXISTS unified_security_scans (
  id SERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES mastyf_ai_instances(instance_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  server_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  cve_count INTEGER DEFAULT 0,
  critical_cve_count INTEGER DEFAULT 0,
  high_cve_count INTEGER DEFAULT 0,
  medium_cve_count INTEGER DEFAULT 0,
  low_cve_count INTEGER DEFAULT 0,
  auth_status JSONB DEFAULT '{}',
  secrets_found INTEGER DEFAULT 0,
  typo_squatting_detected BOOLEAN DEFAULT FALSE,
  details JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_unified_security_instance ON unified_security_scans(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_unified_security_server ON unified_security_scans(server_name, timestamp);

-- Centralized cost records
CREATE TABLE IF NOT EXISTS unified_cost_records (
  id SERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES mastyf_ai_instances(instance_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  server_name TEXT NOT NULL,
  tool_name TEXT,
  tokens_used INTEGER NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL NOT NULL,
  model TEXT,
  pricing_model TEXT,
  calls_per_minute REAL,
  burst_detected BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_unified_cost_instance ON unified_cost_records(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_unified_cost_server ON unified_cost_records(server_name, timestamp);

-- Centralized health check records
CREATE TABLE IF NOT EXISTS unified_health_checks (
  id SERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES mastyf_ai_instances(instance_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  server_name TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  success BOOLEAN DEFAULT FALSE,
  success_rate REAL DEFAULT 0,
  tool_count INTEGER NOT NULL DEFAULT 0,
  overload_warning BOOLEAN DEFAULT FALSE,
  circuit_breaker_state TEXT CHECK (circuit_breaker_state IN ('closed', 'open', 'half_open'))
);

CREATE INDEX IF NOT EXISTS idx_unified_health_instance ON unified_health_checks(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_unified_health_server ON unified_health_checks(server_name, timestamp);

-- Shared AI learning state (replaces .ai-learning.json)
CREATE TABLE IF NOT EXISTS ai_learning_state_shared (
  id SERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES mastyf_ai_instances(instance_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  true_positive_rate REAL DEFAULT 0,
  false_positive_rate REAL DEFAULT 0,
  adaptive_threshold REAL DEFAULT 0.85,
  module_weights JSONB DEFAULT '{"baseline":1.0,"cost":1.0,"threat":1.0,"assist":1.0,"pattern":1.0}',
  total_outcomes INTEGER DEFAULT 0,
  applied_count INTEGER DEFAULT 0,
  rejected_count INTEGER DEFAULT 0,
  modified_count INTEGER DEFAULT 0,
  ignored_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ai_state_instance ON ai_learning_state_shared(instance_id, timestamp);

-- Shared AI learning outcomes (individual feedback records)
CREATE TABLE IF NOT EXISTS ai_learning_outcomes_shared (
  id SERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES mastyf_ai_instances(instance_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  suggestion_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('baseline', 'cost', 'threat', 'assist', 'pattern')),
  action TEXT NOT NULL CHECK (action IN ('applied', 'rejected', 'modified', 'ignored')),
  confidence REAL DEFAULT 0,
  user_feedback TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_ai_outcomes_instance ON ai_learning_outcomes_shared(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_ai_outcomes_rule ON ai_learning_outcomes_shared(rule_name);
CREATE INDEX IF NOT EXISTS idx_ai_outcomes_source ON ai_learning_outcomes_shared(source, action);

-- Shared AI baselines (across all instances)
CREATE TABLE IF NOT EXISTS ai_baselines_shared (
  id SERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES mastyf_ai_instances(instance_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  sample_count INTEGER DEFAULT 0,
  avg_tokens REAL DEFAULT 0,
  stddev_tokens REAL DEFAULT 0,
  avg_latency_ms REAL DEFAULT 0,
  stddev_latency_ms REAL DEFAULT 0,
  hourly_distribution JSONB DEFAULT '[]',
  argument_keys JSONB DEFAULT '[]',
  first_seen TIMESTAMPTZ,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_name, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_ai_baselines_server ON ai_baselines_shared(server_name, tool_name);

-- Live threat intelligence feed entries
CREATE TABLE IF NOT EXISTS mastyf-ai_threat_feed (
  id SERIAL PRIMARY KEY,
  threat_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('NVD', 'OSV', 'GitHub', 'custom')),
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  affected_package TEXT,
  affected_pattern TEXT,
  signature TEXT,
  description TEXT NOT NULL,
  remediation TEXT,
  published_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  auto_blocked BOOLEAN DEFAULT FALSE,
  matching_server_name TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_threat_feed_severity ON mastyf-ai_threat_feed(severity, ingested_at);
CREATE INDEX IF NOT EXISTS idx_threat_feed_source ON mastyf-ai_threat_feed(source);

-- Mastyf AI logs (structured logging from pino → PG)
CREATE TABLE IF NOT EXISTS mastyf-ai_logs (
  id SERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES mastyf_ai_instances(instance_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  level INTEGER NOT NULL,
  level_name TEXT NOT NULL,
  message TEXT NOT NULL,
  module TEXT,
  server_name TEXT,
  tool_name TEXT,
  request_id TEXT,
  error TEXT,
  stack TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mastyf-ai_logs_instance ON mastyf-ai_logs(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_mastyf-ai_logs_level ON mastyf-ai_logs(level, timestamp);
CREATE INDEX IF NOT EXISTS idx_mastyf-ai_logs_server ON mastyf-ai_logs(server_name, timestamp);
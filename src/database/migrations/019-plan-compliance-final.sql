-- Migration 019: Reputation Byzantine quorum votes + threat model persistence

CREATE TABLE IF NOT EXISTS reputation_rater_votes (
  server_hash TEXT NOT NULL,
  rater_id TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  rater_weight REAL NOT NULL DEFAULT 1.0,
  attestation_jws TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (server_hash, rater_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_rep_votes_server ON reputation_rater_votes(server_hash, tenant_id);

CREATE TABLE IF NOT EXISTS threat_model_reports (
  report_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  config_path TEXT,
  report_json TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_threat_model_created ON threat_model_reports(tenant_id, created_at DESC);

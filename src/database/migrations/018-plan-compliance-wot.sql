-- Migration 018: Reputation web-of-trust edges + federated gradient snapshots

CREATE TABLE IF NOT EXISTS reputation_trust_edges (
  from_rater_id TEXT NOT NULL,
  to_rater_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_rater_id, to_rater_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS federated_gradient_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  gradient_json TEXT NOT NULL,
  contributor_count INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fl_gradient_version ON federated_gradient_snapshots(model_version, created_at DESC);

-- Migration 014: Federated learning deltas and rollout tracking (B3)

CREATE TABLE IF NOT EXISTS federated_model_deltas (
  delta_id TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  signature_hash TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  privacy_budget_epsilon REAL NOT NULL DEFAULT 1.0,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fl_delta_version ON federated_model_deltas(model_version, created_at DESC);

CREATE TABLE IF NOT EXISTS federated_rollout_decisions (
  rollout_id TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  stage TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  approval_id TEXT,
  reason TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

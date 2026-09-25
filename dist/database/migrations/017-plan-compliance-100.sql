-- Migration 017: Final plan-compliance tables (B3 weights, B1 rater trust)

CREATE TABLE IF NOT EXISTS federated_model_weights (
  model_version TEXT PRIMARY KEY,
  weights_json TEXT NOT NULL,
  contributor_count INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fl_weights_tenant ON federated_model_weights(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reputation_rater_trust (
  rater_id TEXT PRIMARY KEY,
  trust_score REAL NOT NULL DEFAULT 1.0,
  attestation_count INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

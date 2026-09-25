-- Shared instant attack learning state (multi-replica K8s)

CREATE TABLE IF NOT EXISTS ai_attack_learning_state_shared (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_attack_learning_updated ON ai_attack_learning_state_shared(updated_at DESC);

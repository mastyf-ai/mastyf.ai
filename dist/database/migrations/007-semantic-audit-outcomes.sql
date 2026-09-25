-- Async semantic audit outcomes + operator labels (Security Swarm calibrator)
CREATE TABLE IF NOT EXISTS semantic_audit_outcomes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  request_id TEXT,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  sync_decision JSONB NOT NULL,
  semantic_audit JSONB NOT NULL,
  model TEXT,
  duration_ms INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  labeled BOOLEAN NOT NULL DEFAULT false,
  label TEXT CHECK (label IN ('true_positive', 'false_positive', 'ignored')),
  label_user_id TEXT,
  label_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_semantic_audit_tenant_time
  ON semantic_audit_outcomes (tenant_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_audit_labeled
  ON semantic_audit_outcomes (tenant_id, labeled, recorded_at DESC);

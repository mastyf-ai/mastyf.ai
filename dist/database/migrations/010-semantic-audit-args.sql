-- Redacted argument snapshots for counterfactual policy replay
ALTER TABLE semantic_audit_outcomes
  ADD COLUMN IF NOT EXISTS arguments_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_semantic_audit_tool_time
  ON semantic_audit_outcomes (tenant_id, tool_name, recorded_at DESC);

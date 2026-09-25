-- Per-tenant audit trail scoping (shared PostgreSQL aggregation)

ALTER TABLE unified_audit_trail
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_audit_trail_tenant
  ON unified_audit_trail (tenant_id, timestamp DESC);

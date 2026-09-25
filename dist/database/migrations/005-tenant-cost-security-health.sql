-- Per-tenant scoping for cost, security, and health audit tables

-- Local per-instance tables (postgres-db)
ALTER TABLE security_scans
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE cost_records
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE call_records
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_security_scans_tenant
  ON security_scans (tenant_id, server_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_cost_records_tenant
  ON cost_records (tenant_id, server_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_health_checks_tenant
  ON health_checks (tenant_id, server_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_call_records_tenant
  ON call_records (tenant_id, server_name, timestamp DESC);

-- Centralized aggregation tables
ALTER TABLE unified_security_scans
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE unified_cost_records
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE unified_health_checks
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_unified_security_tenant
  ON unified_security_scans (tenant_id, server_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_unified_cost_tenant
  ON unified_cost_records (tenant_id, server_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_unified_health_tenant
  ON unified_health_checks (tenant_id, server_name, timestamp DESC);

-- Query performance indexes for tenant/server time-range scans

CREATE INDEX IF NOT EXISTS idx_call_records_tenant_ts
  ON call_records (tenant_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_call_records_server_ts
  ON call_records (server_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_cost_records_tenant_ts
  ON cost_records (tenant_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_cost_records_server_ts
  ON cost_records (server_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_security_scans_tenant_ts
  ON security_scans (tenant_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_security_scans_server_ts
  ON security_scans (server_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_health_checks_tenant_ts
  ON health_checks (tenant_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_health_checks_server_ts
  ON health_checks (server_name, timestamp DESC);

-- Unified aggregation tables (audit sync)
CREATE INDEX IF NOT EXISTS idx_unified_cost_tenant_ts
  ON unified_cost_records (tenant_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_unified_cost_server_ts
  ON unified_cost_records (server_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_unified_security_tenant_ts
  ON unified_security_scans (tenant_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_unified_health_tenant_ts
  ON unified_health_checks (tenant_id, timestamp DESC);

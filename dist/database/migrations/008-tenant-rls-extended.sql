-- Extend RLS to all per-tenant history tables (§6.1 Issue #4).

ALTER TABLE IF EXISTS security_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS security_scans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_scans_tenant_isolation ON security_scans;
CREATE POLICY security_scans_tenant_isolation ON security_scans
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE IF EXISTS cost_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cost_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_records_tenant_isolation ON cost_records;
CREATE POLICY cost_records_tenant_isolation ON cost_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE IF EXISTS health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS health_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS health_checks_tenant_isolation ON health_checks;
CREATE POLICY health_checks_tenant_isolation ON health_checks
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS call_records_tenant_isolation ON call_records;
CREATE POLICY call_records_tenant_isolation ON call_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS unified_audit_tenant_isolation ON unified_audit_trail;
CREATE POLICY unified_audit_tenant_isolation ON unified_audit_trail
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

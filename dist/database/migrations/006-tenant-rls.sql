-- Optional row-level security for multi-tenant Postgres (enable with MASTYF_AI_PG_RLS_ENABLED=true).
-- Application must SET app.tenant_id = '<tenant>' per connection/session.

ALTER TABLE IF EXISTS call_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS call_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_records_tenant_isolation ON call_records;
CREATE POLICY call_records_tenant_isolation ON call_records
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE IF EXISTS unified_audit_trail ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS unified_audit_trail FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unified_audit_tenant_isolation ON unified_audit_trail;
CREATE POLICY unified_audit_tenant_isolation ON unified_audit_trail
  USING (tenant_id = current_setting('app.tenant_id', true));

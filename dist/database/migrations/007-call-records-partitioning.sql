-- Optional monthly partitioning for call_records (PostgreSQL 14+).
-- Apply manually in maintenance window; Mastyf AI migrations runner may skip if unsupported.
--
-- Example (adjust dates):
-- CREATE TABLE call_records_2026_05 PARTITION OF call_records
--   FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
--
CREATE INDEX IF NOT EXISTS idx_call_records_tenant_recorded
  ON call_records (tenant_id, recorded_at DESC);

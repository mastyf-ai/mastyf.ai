-- Migration 015: Phase 3 performance indexes

CREATE INDEX IF NOT EXISTS idx_reputation_level ON reputation_network_entries(level, consensus_score DESC);
CREATE INDEX IF NOT EXISTS idx_observatory_metric ON observatory_telemetry(metric_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_tenant ON insurance_risk_reports(tenant_id, created_at DESC);

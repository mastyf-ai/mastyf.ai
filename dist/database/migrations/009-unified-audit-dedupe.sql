-- Incremental audit sync dedupe: source SQLite row id + per-server cursors

ALTER TABLE unified_audit_trail
  ADD COLUMN IF NOT EXISTS source_record_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unified_audit_trail_source_dedupe
  ON unified_audit_trail (instance_id, tenant_id, server_name, source_record_id)
  WHERE source_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_sync_cursors (
  instance_id TEXT NOT NULL REFERENCES mastyf_ai_instances(instance_id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  server_name TEXT NOT NULL,
  last_source_id BIGINT NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (instance_id, tenant_id, server_name)
);

CREATE INDEX IF NOT EXISTS idx_audit_sync_cursors_instance
  ON audit_sync_cursors (instance_id, last_synced_at DESC);

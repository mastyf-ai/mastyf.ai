-- Migration 018: where each workspace's Laya calls go. No row (or mode 'shared') means the
-- shared server; 'dedicated' rows name their own endpoint and the env variable holding that
-- server's secret (secret_ref, never the secret itself); 'self_hosted' workspaces run Laya
-- themselves and are refused by the cloud route.

CREATE TABLE IF NOT EXISTS laya_deployments (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('shared', 'dedicated', 'self_hosted')),
  endpoint TEXT,
  secret_ref TEXT,
  model TEXT,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('provisioning', 'active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (mode <> 'dedicated' OR (endpoint IS NOT NULL AND secret_ref IS NOT NULL))
);

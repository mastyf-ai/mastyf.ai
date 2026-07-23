-- Migration: IDP Federation Support
-- Adds external identity provider columns to auth_users and creates the
-- auth_idp_configs table for per-tenant IdP configuration.

-- 1. Extend auth_users with identity provider fields
ALTER TABLE auth_users ADD COLUMN idp_provider TEXT;
ALTER TABLE auth_users ADD COLUMN idp_user_id TEXT;
ALTER TABLE auth_users ADD COLUMN idp_email TEXT;
ALTER TABLE auth_users ADD COLUMN idp_display_name TEXT;
ALTER TABLE auth_users ADD COLUMN idp_access_token TEXT;
ALTER TABLE auth_users ADD COLUMN idp_refresh_token TEXT;
ALTER TABLE auth_users ADD COLUMN idp_token_expires_at TEXT;

-- Make password_hash nullable for federated users (no local password)
ALTER TABLE auth_users ALTER COLUMN password_hash DROP NOT NULL;

-- Unique constraint: one IdP identity per provider per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_idp
  ON auth_users (tenant_id, idp_provider, idp_user_id)
  WHERE idp_provider IS NOT NULL AND idp_user_id IS NOT NULL;

-- 2. Create IdP configuration table
CREATE TABLE IF NOT EXISTS auth_idp_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('oidc', 'saml')),
  name TEXT NOT NULL,
  issuer_url TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  claim_mappings TEXT NOT NULL DEFAULT '{}',
  role_map TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_idp_configs_tenant
  ON auth_idp_configs (tenant_id);

-- 3. Create credential broker storage table
CREATE TABLE IF NOT EXISTS auth_credentials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('oauth2', 'api_key', 'bearer_token')),
  encrypted_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_credentials_lookup
  ON auth_credentials (tenant_id, provider_id, credential_type);

CREATE INDEX IF NOT EXISTS idx_auth_credentials_user
  ON auth_credentials (user_id);

-- 4. Create threat feed subscriptions table
CREATE TABLE IF NOT EXISTS threat_feed_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sync TEXT,
  added_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_threat_feed_sub_tenant
  ON threat_feed_subscriptions (tenant_id);

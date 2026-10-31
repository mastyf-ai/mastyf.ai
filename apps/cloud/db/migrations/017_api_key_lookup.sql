-- Migration 017: look API keys up by their prefix instead of checking every key, and hash new
-- keys with SHA-256 (they are 256-bit random, so a slow hash adds nothing). Existing keys keep
-- their bcrypt hashes. Adds the laya:classify scope to the defaults and to every live key.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS hash_scheme TEXT NOT NULL DEFAULT 'bcrypt'
  CHECK (hash_scheme IN ('bcrypt', 'sha256'));
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
ALTER TABLE api_keys ALTER COLUMN scopes SET DEFAULT '["badge:read","policy:read","laya:classify"]';
UPDATE api_keys
   SET scopes = (scopes::jsonb || '["laya:classify"]'::jsonb)::text
 WHERE revoked_at IS NULL AND scopes LIKE '[%' AND scopes NOT LIKE '%laya:classify%';

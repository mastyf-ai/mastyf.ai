-- Migration 022: a secret for the device a one-device key is tied to. Shield asks for it at
-- activation and sends it back on every check, so the key and the device's name are no longer enough
-- to use the key somewhere else. Only its SHA-256 is stored. Null until the device asks for one, so
-- older Shield versions keep working.
-- Rollback (by hand): ALTER TABLE commercial_entitlements DROP COLUMN device_secret_hash;

ALTER TABLE commercial_entitlements ADD COLUMN IF NOT EXISTS device_secret_hash TEXT;

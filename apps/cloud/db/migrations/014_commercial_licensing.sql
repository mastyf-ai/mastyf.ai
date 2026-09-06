-- Migration 014: Mastyf Guard Commercial Access, Idempotent Webhook Logs & Entitlement Projections

CREATE TABLE IF NOT EXISTS commercial_customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  lemon_customer_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_customers_email ON commercial_customers(email);
CREATE INDEX IF NOT EXISTS idx_commercial_customers_lemon_id ON commercial_customers(lemon_customer_id);

CREATE TABLE IF NOT EXISTS commercial_subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES commercial_customers(id) ON DELETE CASCADE,
  lemon_subscription_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL, -- on_trial, active, paused, past_due, unpaid, cancelled, expired
  product_id TEXT,
  variant_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  lemon_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_subscriptions_lemon_id ON commercial_subscriptions(lemon_subscription_id);
CREATE INDEX IF NOT EXISTS idx_commercial_subscriptions_customer_id ON commercial_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_commercial_subscriptions_status ON commercial_subscriptions(status);

CREATE TABLE IF NOT EXISTS commercial_entitlements (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES commercial_customers(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES commercial_subscriptions(id) ON DELETE SET NULL,
  product TEXT NOT NULL DEFAULT 'mastyf-guard-pro',
  license_key_hash TEXT NOT NULL UNIQUE,
  license_key_preview TEXT,
  lemon_license_id TEXT UNIQUE,
  lemon_instance_id TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active, grace_period, expired, disabled
  activation_limit INTEGER NOT NULL DEFAULT 2,
  instances_count INTEGER NOT NULL DEFAULT 0,
  last_validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_entitlements_key_hash ON commercial_entitlements(license_key_hash);
CREATE INDEX IF NOT EXISTS idx_commercial_entitlements_customer_id ON commercial_entitlements(customer_id);
CREATE INDEX IF NOT EXISTS idx_commercial_entitlements_status ON commercial_entitlements(status);

CREATE TABLE IF NOT EXISTS hf_entitlements (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES commercial_customers(id) ON DELETE CASCADE,
  hf_username TEXT NOT NULL UNIQUE,
  repo_id TEXT NOT NULL DEFAULT 'Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened',
  status TEXT NOT NULL DEFAULT 'pending_request', -- pending_request, granted, revoked, sync_error
  last_synced_at TIMESTAMPTZ,
  error_message TEXT,
  is_permanently_bound BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hf_entitlements_username ON hf_entitlements(hf_username);
CREATE INDEX IF NOT EXISTS idx_hf_entitlements_customer_id ON hf_entitlements(customer_id);

CREATE TABLE IF NOT EXISTS webhook_event_logs (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed', -- processed, ignored, failed
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_event_logs_hash ON webhook_event_logs(payload_hash);

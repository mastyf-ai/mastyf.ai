-- Migration 020: people a Team lead has added to a workspace. A seat starts as an invitation with a
-- one-time code sent to that email, and becomes joined when the code is entered in Shield.

CREATE TABLE IF NOT EXISTS workspace_seats (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL, -- lower case
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'joined')),
  code_hash TEXT, -- null once used; the code itself is never stored
  code_expires_at TIMESTAMPTZ,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  code_sent_at TIMESTAMPTZ,
  entitlement_id TEXT REFERENCES commercial_entitlements(id) ON DELETE SET NULL,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_workspace_seats_email ON workspace_seats(email);

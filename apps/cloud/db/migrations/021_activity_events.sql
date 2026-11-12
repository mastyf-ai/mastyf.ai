-- Migration 021: activity records sent by the `mastyf` command (free) and the Shield app (paid).
-- One row per tool call, tool result or agent action: the decision and a snippet redacted on the
-- user's machine. Raw arguments are never stored. Free rows are kept 7 days, paid rows 12 months;
-- the ingest route deletes a workspace's expired rows as it inserts new ones.
-- Rollback (by hand, deletes every record): DROP TABLE activity_events;

CREATE TABLE IF NOT EXISTS activity_events (
  owner_id TEXT NOT NULL,      -- organizations.id, or 'customer:<id>' for a buyer with no site account
  id TEXT NOT NULL,            -- chosen by the client, so a retried batch is stored once
  tier TEXT NOT NULL CHECK (tier IN ('free', 'paid')),
  member_email TEXT,           -- set when a Team member's key sent it
  instance_id TEXT,
  agent TEXT,
  server TEXT NOT NULL,
  tool TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('call', 'result', 'action')),
  verdict TEXT NOT NULL CHECK (verdict IN ('allow', 'block', 'flag', 'held')),
  rule TEXT,
  reason TEXT,
  latency_ms INTEGER,
  fingerprint TEXT,
  snippet TEXT,
  session_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_activity_events_owner_time ON activity_events (owner_id, occurred_at DESC);

-- Migration 013: Control Plane — Centralized Policy Distribution, Fleet Audit, Teams & Licensing

-- 1. Policy version history for distribution tracking
CREATE TABLE IF NOT EXISTS policy_versions (
  id SERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  yaml_content TEXT NOT NULL,
  published_by TEXT REFERENCES users(id),
  published_at TIMESTAMPTZ DEFAULT NOW(),
  rollout_complete BOOLEAN DEFAULT FALSE,
  UNIQUE (org_id, version)
);

-- 2. Teams within organizations
CREATE TABLE IF NOT EXISTS teams (
  id UUID DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member')),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_policies (
  id UUID DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  yaml_content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (org_id, team_id),
  FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id) ON DELETE CASCADE
);

-- 3. Fleet audit aggregation from proxy instances
CREATE TABLE IF NOT EXISTS fleet_audit_aggregates (
  id SERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_requests INTEGER DEFAULT 0,
  blocked_requests INTEGER DEFAULT 0,
  allowed_requests INTEGER DEFAULT 0,
  flagged_requests INTEGER DEFAULT 0,
  top_blocked_tools JSONB DEFAULT '[]',
  top_blocked_rules JSONB DEFAULT '[]',
  avg_latency_ms REAL DEFAULT 0,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fleet_audit_org_period ON fleet_audit_aggregates(org_id, period_end DESC);

-- 4. License tiers
CREATE TABLE IF NOT EXISTS licenses (
  id UUID DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team', 'enterprise')),
  max_instances INTEGER DEFAULT 1,
  max_teams INTEGER DEFAULT 0,
  max_users INTEGER DEFAULT 1,
  features JSONB DEFAULT '[]',
  activated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (org_id)
);

-- 5. Public threat feed serving
CREATE TABLE IF NOT EXISTS public_threat_feed_entries (
  id SERIAL PRIMARY KEY,
  signature_hash TEXT UNIQUE NOT NULL,
  tool_pattern TEXT NOT NULL,
  arg_pattern_hash TEXT NOT NULL,
  category TEXT NOT NULL,
  block_reason TEXT,
  report_count INTEGER DEFAULT 1,
  feed_version INTEGER DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_threat_feed_category ON public_threat_feed_entries(category);
CREATE INDEX IF NOT EXISTS idx_threat_feed_last_seen ON public_threat_feed_entries(last_seen DESC);

-- 6. Public trust score database
CREATE TABLE IF NOT EXISTS public_trust_scores (
  package_name TEXT PRIMARY KEY,
  trust_score INTEGER NOT NULL,
  trust_grade TEXT NOT NULL,
  dimensions JSONB DEFAULT '{}',
  cve_count INTEGER DEFAULT 0,
  critical_cve_count INTEGER DEFAULT 0,
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  report_count INTEGER DEFAULT 1
);

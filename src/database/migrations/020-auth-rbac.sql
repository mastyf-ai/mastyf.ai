-- Migration 020: Authentication & RBAC
-- Adds first-class, database-backed users/groups/roles/permissions,
-- server-side sessions, and a durable audit log.
--
-- Design notes:
--   * All tables are tenant-scoped (tenant_id) to match the existing
--     multi-tenant convention used throughout src/database/migrations/*.
--   * Passwords are never stored in plaintext — only an Argon2id hash.
--   * Session tokens are never stored in plaintext — only a SHA-256 hash
--     of the token, so a DB leak alone cannot be used to hijack sessions.
--   * Roles are DB rows (not hardcoded), so "custom roles" are supported
--     out of the box. Four system roles are seeded and cannot be deleted:
--     admin, tenant-admin, operator, analyst, viewer (mapped to the
--     existing DashboardRole tier for backward compatibility).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'locked')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_ip TEXT,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  UNIQUE (tenant_id, username),
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_auth_users_tenant ON auth_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_auth_users_status ON auth_users(tenant_id, status);

CREATE TABLE IF NOT EXISTS auth_permissions (
  key TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  dashboard_tier TEXT NOT NULL DEFAULT 'viewer'
    CHECK (dashboard_tier IN ('viewer', 'analyst', 'operator', 'admin', 'tenant-admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_auth_roles_tenant ON auth_roles(tenant_id);

CREATE TABLE IF NOT EXISTS auth_role_permissions (
  role_id UUID NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES auth_permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS auth_user_roles (
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS auth_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_auth_groups_tenant ON auth_groups(tenant_id);

CREATE TABLE IF NOT EXISTS auth_group_roles (
  group_id UUID NOT NULL REFERENCES auth_groups(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, role_id)
);

CREATE TABLE IF NOT EXISTS auth_user_groups (
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES auth_groups(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by UUID,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_secret TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id UUID,
  username TEXT,
  action TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_tenant_time ON auth_audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_action ON auth_audit_logs(action, created_at DESC);

-- Single-row-per-tenant settings blob: password policy, lockout policy,
-- session timeout, auth toggles. Kept as JSONB for forward compatibility.
CREATE TABLE IF NOT EXISTS auth_settings (
  tenant_id TEXT PRIMARY KEY DEFAULT 'default',
  settings JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

-- Tracks whether the one-time initial-setup flow has been completed.
-- Once true, POST /api/auth/setup is permanently disabled for the tenant.
CREATE TABLE IF NOT EXISTS auth_setup_state (
  tenant_id TEXT PRIMARY KEY DEFAULT 'default',
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ
);

-- Seed canonical permissions.
INSERT INTO auth_permissions (key, category, description) VALUES
  ('dashboard.read', 'dashboard', 'View dashboard, security, cost, and health data'),
  ('dashboard.export', 'dashboard', 'Export dashboard data and reports'),
  ('policy.test', 'policy', 'Run policy tests / dry-runs'),
  ('policy.mutate', 'policy', 'Create or modify policy rules'),
  ('ai.use', 'ai', 'Use AI-assisted features (copilot, investigation, tribunal)'),
  ('users.read', 'users', 'View user accounts'),
  ('users.manage', 'users', 'Create, edit, delete user accounts and reset passwords'),
  ('groups.read', 'groups', 'View groups'),
  ('groups.manage', 'groups', 'Create, edit, delete groups and manage membership'),
  ('roles.read', 'roles', 'View roles and permissions'),
  ('roles.manage', 'roles', 'Create, edit, delete roles and assign permissions'),
  ('sessions.read.self', 'sessions', 'View own active sessions'),
  ('sessions.read.all', 'sessions', 'View any user''s active sessions'),
  ('sessions.revoke', 'sessions', 'Revoke sessions'),
  ('audit.read', 'audit', 'View audit log'),
  ('settings.read', 'settings', 'View authentication/security settings'),
  ('settings.manage', 'settings', 'Modify authentication/security settings'),
  ('profile.manage.self', 'profile', 'Manage own profile and password')
ON CONFLICT (key) DO NOTHING;

-- Seed system roles (idempotent).
INSERT INTO auth_roles (id, tenant_id, name, description, is_system, dashboard_tier)
VALUES
  (gen_random_uuid(), 'default', 'Administrator', 'Full access to all features, users, and settings', TRUE, 'admin'),
  (gen_random_uuid(), 'default', 'Tenant Administrator', 'Full access scoped to a single tenant', TRUE, 'tenant-admin'),
  (gen_random_uuid(), 'default', 'Operator', 'Can test and mutate policy, use AI tooling', TRUE, 'operator'),
  (gen_random_uuid(), 'default', 'Analyst', 'Can read and export dashboard data', TRUE, 'analyst'),
  (gen_random_uuid(), 'default', 'Viewer', 'Read-only dashboard access', TRUE, 'viewer')
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Wire permissions to system roles.
INSERT INTO auth_role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM auth_roles r
CROSS JOIN auth_permissions p
WHERE r.tenant_id = 'default' AND r.name = 'Administrator' AND r.is_system = TRUE
ON CONFLICT DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM auth_roles r
CROSS JOIN auth_permissions p
WHERE r.tenant_id = 'default' AND r.name = 'Tenant Administrator' AND r.is_system = TRUE
  AND p.key NOT IN ('users.manage')
ON CONFLICT DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM auth_roles r
CROSS JOIN auth_permissions p
WHERE r.tenant_id = 'default' AND r.name = 'Operator' AND r.is_system = TRUE
  AND p.key IN ('dashboard.read', 'dashboard.export', 'policy.test', 'policy.mutate', 'ai.use',
                'sessions.read.self', 'profile.manage.self', 'audit.read')
ON CONFLICT DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM auth_roles r
CROSS JOIN auth_permissions p
WHERE r.tenant_id = 'default' AND r.name = 'Analyst' AND r.is_system = TRUE
  AND p.key IN ('dashboard.read', 'dashboard.export', 'policy.test', 'sessions.read.self', 'profile.manage.self')
ON CONFLICT DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM auth_roles r
CROSS JOIN auth_permissions p
WHERE r.tenant_id = 'default' AND r.name = 'Viewer' AND r.is_system = TRUE
  AND p.key IN ('dashboard.read', 'sessions.read.self', 'profile.manage.self')
ON CONFLICT DO NOTHING;

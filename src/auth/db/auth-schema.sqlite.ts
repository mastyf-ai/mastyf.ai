/**
 * SQLite schema for the auth/RBAC subsystem.
 *
 * The rest of mastyf.ai defaults to a local SQLite file (DB_TYPE unset or
 * `sqlite`) and only uses PostgreSQL when DB_TYPE=postgres. The Postgres
 * schema lives in src/database/migrations/020-auth-rbac.sql and is applied
 * by the existing Flyway-style migration-runner. SQLite has no such runner
 * wired up for this subsystem, so we apply the equivalent DDL idempotently
 * at startup (CREATE TABLE IF NOT EXISTS — safe to run on every boot).
 *
 * Schema is intentionally kept 1:1 with the Postgres version (same table
 * and column names) so the two AuthDbAdapter implementations can share
 * identical SQL for everything except a handful of dialect differences
 * (UUID generation, JSON storage, RETURNING support) which are isolated
 * in auth-db.ts.
 */
export const SQLITE_AUTH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  last_login_ip TEXT,
  password_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
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
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0,
  dashboard_tier TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_auth_roles_tenant ON auth_roles(tenant_id);

CREATE TABLE IF NOT EXISTS auth_role_permissions (
  role_id TEXT NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES auth_permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS auth_user_roles (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  assigned_by TEXT,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS auth_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_auth_groups_tenant ON auth_groups(tenant_id);

CREATE TABLE IF NOT EXISTS auth_group_roles (
  group_id TEXT NOT NULL REFERENCES auth_groups(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, role_id)
);

CREATE TABLE IF NOT EXISTS auth_user_groups (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES auth_groups(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  added_by TEXT,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_secret TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT,
  username TEXT,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_tenant_time ON auth_audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_action ON auth_audit_logs(action, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_settings (
  tenant_id TEXT PRIMARY KEY DEFAULT 'default',
  settings TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS auth_setup_state (
  tenant_id TEXT PRIMARY KEY DEFAULT 'default',
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);
`;

/** Canonical permission catalog — shared source of truth for seeding both backends. */
export const AUTH_PERMISSIONS: Array<{ key: string; category: string; description: string }> = [
  { key: 'dashboard.read', category: 'dashboard', description: 'View dashboard, security, cost, and health data' },
  { key: 'dashboard.export', category: 'dashboard', description: 'Export dashboard data and reports' },
  { key: 'policy.test', category: 'policy', description: 'Run policy tests / dry-runs' },
  { key: 'policy.mutate', category: 'policy', description: 'Create or modify policy rules' },
  { key: 'ai.use', category: 'ai', description: 'Use AI-assisted features (copilot, investigation, tribunal)' },
  { key: 'users.read', category: 'users', description: 'View user accounts' },
  { key: 'users.manage', category: 'users', description: 'Create, edit, delete user accounts and reset passwords' },
  { key: 'groups.read', category: 'groups', description: 'View groups' },
  { key: 'groups.manage', category: 'groups', description: 'Create, edit, delete groups and manage membership' },
  { key: 'roles.read', category: 'roles', description: 'View roles and permissions' },
  { key: 'roles.manage', category: 'roles', description: 'Create, edit, delete roles and assign permissions' },
  { key: 'sessions.read.self', category: 'sessions', description: "View own active sessions" },
  { key: 'sessions.read.all', category: 'sessions', description: "View any user's active sessions" },
  { key: 'sessions.revoke', category: 'sessions', description: 'Revoke sessions' },
  { key: 'audit.read', category: 'audit', description: 'View audit log' },
  { key: 'settings.read', category: 'settings', description: 'View authentication/security settings' },
  { key: 'settings.manage', category: 'settings', description: 'Modify authentication/security settings' },
  { key: 'profile.manage.self', category: 'profile', description: 'Manage own profile and password' },
];

export const SYSTEM_ROLES: Array<{
  name: string;
  description: string;
  dashboardTier: 'viewer' | 'analyst' | 'operator' | 'admin' | 'tenant-admin';
  permissions: string[];
}> = [
  {
    name: 'Administrator',
    description: 'Full access to all features, users, and settings',
    dashboardTier: 'admin',
    permissions: AUTH_PERMISSIONS.map((p) => p.key),
  },
  {
    name: 'Tenant Administrator',
    description: 'Full access scoped to a single tenant',
    dashboardTier: 'tenant-admin',
    permissions: AUTH_PERMISSIONS.map((p) => p.key).filter((k) => k !== 'users.manage'),
  },
  {
    name: 'Operator',
    description: 'Can test and mutate policy, use AI tooling',
    dashboardTier: 'operator',
    permissions: [
      'dashboard.read', 'dashboard.export', 'policy.test', 'policy.mutate', 'ai.use',
      'sessions.read.self', 'profile.manage.self', 'audit.read',
    ],
  },
  {
    name: 'Analyst',
    description: 'Can read and export dashboard data',
    dashboardTier: 'analyst',
    permissions: ['dashboard.read', 'dashboard.export', 'policy.test', 'sessions.read.self', 'profile.manage.self'],
  },
  {
    name: 'Viewer',
    description: 'Read-only dashboard access',
    dashboardTier: 'viewer',
    permissions: ['dashboard.read', 'sessions.read.self', 'profile.manage.self'],
  },
];

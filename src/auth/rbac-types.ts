/**
 * Types for the database-backed authentication & RBAC subsystem.
 * (Distinct from src/auth/auth-types.ts, which covers OAuth/OIDC identity
 * for MCP agent clients — this file covers human dashboard users.)
 */

export type UserStatus = 'active' | 'disabled' | 'locked';

export interface AuthUser {
  id: string;
  tenantId: string;
  username: string;
  email: string;
  displayName: string;
  status: UserStatus;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  passwordChangedAt: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

/** AuthUser plus resolved roles/groups/permissions — what /api/auth/me returns. */
export interface AuthUserWithAccess extends AuthUser {
  roles: RoleSummary[];
  groups: GroupSummary[];
  permissions: string[];
  dashboardRoles: string[]; // coarse DashboardRole tiers, for legacy frontend gating
}

export interface RoleSummary {
  id: string;
  name: string;
  dashboardTier: DashboardTier;
}

export interface GroupSummary {
  id: string;
  name: string;
}

export type DashboardTier = 'viewer' | 'analyst' | 'operator' | 'admin' | 'tenant-admin';

export interface AuthRole {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  isSystem: boolean;
  dashboardTier: DashboardTier;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthGroup {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  roleIds: string[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthPermissionDef {
  key: string;
  category: string;
  description: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current?: boolean;
}

export type AuditResult = 'success' | 'failure';

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  userId: string | null;
  username: string | null;
  action: string;
  result: AuditResult;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  disallowUsernameInPassword: boolean;
  passwordHistoryCount: number;
  /** 0 disables expiry-based forced rotation. */
  maxAgeDays: number;
}

export interface LockoutPolicy {
  maxFailedAttempts: number;
  lockoutDurationMinutes: number;
}

export interface AuthSettings {
  passwordPolicy: PasswordPolicy;
  lockoutPolicy: LockoutPolicy;
  sessionTimeoutMinutes: number;
  /** If true, new sessions are killed after this many minutes regardless of activity. */
  sessionAbsoluteTimeoutMinutes: number;
  requireMfaForAdmins: boolean;
  allowSelfRegistration: boolean;
}

/** Well-known audit action names (not exhaustive — free-text `action` is allowed). */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  SETUP_COMPLETE: 'auth.setup.complete',
  PASSWORD_CHANGE: 'auth.password.change',
  PASSWORD_RESET_BY_ADMIN: 'auth.password.reset_by_admin',
  FORCE_PASSWORD_CHANGE: 'auth.password.force_change_flag',
  ACCOUNT_LOCKED: 'auth.account.locked',
  ACCOUNT_UNLOCKED: 'auth.account.unlocked',
  ACCOUNT_DISABLED: 'auth.account.disabled',
  ACCOUNT_ENABLED: 'auth.account.enabled',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  GROUP_CREATED: 'group.created',
  GROUP_UPDATED: 'group.updated',
  GROUP_DELETED: 'group.deleted',
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',
  SESSION_REVOKED: 'session.revoked',
  SETTINGS_UPDATED: 'settings.updated',
} as const;

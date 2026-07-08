'use client';

import { mastyfAiFetch, buildMutatingHeaders } from './mastyf-ai-api';

// ── Types ──────────────────────────────────────────────────────────────────

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
  roles: Array<{ id: string; name: string; dashboardTier: string }>;
  groups: Array<{ id: string; name: string }>;
  permissions: string[];
  dashboardRoles: string[];
}

export interface AuthRole {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  dashboardTier: 'viewer' | 'analyst' | 'operator' | 'admin' | 'tenant-admin';
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthGroup {
  id: string;
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

export interface AuthSessionInfo {
  id: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current?: boolean;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  username: string | null;
  action: string;
  result: 'success' | 'failure';
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuthSettings {
  passwordPolicy: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumber: boolean;
    requireSymbol: boolean;
    disallowUsernameInPassword: boolean;
    passwordHistoryCount: number;
    maxAgeDays: number;
  };
  lockoutPolicy: {
    maxFailedAttempts: number;
    lockoutDurationMinutes: number;
  };
  sessionTimeoutMinutes: number;
  sessionAbsoluteTimeoutMinutes: number;
  requireMfaForAdmins: boolean;
  allowSelfRegistration: boolean;
}

async function asJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data;
}

// ── Initial setup ────────────────────────────────────────────────────────

export async function fetchAuthSetupStatus(): Promise<{ setupRequired: boolean }> {
  const res = await mastyfAiFetch('/api/auth/setup/status');
  return asJson(res);
}

export async function submitAuthSetup(input: {
  username: string;
  email: string;
  displayName: string;
  password: string;
}): Promise<{ success: boolean; userId: string }> {
  const res = await mastyfAiFetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return asJson(res);
}

// ── Current user ─────────────────────────────────────────────────────────

export async function fetchCurrentUser(): Promise<{ user: AuthUser } | null> {
  const res = await mastyfAiFetch('/api/auth/me');
  if (!res.ok) return null;
  return res.json();
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/auth/change-password', {
    method: 'POST',
    headers,
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  await asJson(res);
}

export async function fetchOwnSessions(): Promise<{ sessions: AuthSessionInfo[] }> {
  const res = await mastyfAiFetch('/api/auth/sessions');
  return asJson(res);
}

export async function revokeSession(id: string): Promise<void> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/auth/sessions/${id}`, { method: 'DELETE', headers });
  await asJson(res);
}

export async function fetchOwnLoginHistory(): Promise<{ entries: AuditLogEntry[] }> {
  const res = await mastyfAiFetch('/api/auth/login-history');
  return asJson(res);
}

// ── User management ──────────────────────────────────────────────────────

export async function fetchUsers(): Promise<{ users: AuthUser[] }> {
  const res = await mastyfAiFetch('/api/users');
  return asJson(res);
}

export async function createUser(input: {
  username: string;
  email: string;
  displayName: string;
  password?: string;
  status?: UserStatus;
  mustChangePassword?: boolean;
  roleIds?: string[];
  groupIds?: string[];
}): Promise<{ user: AuthUser; temporaryPassword?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/users', { method: 'POST', headers, body: JSON.stringify(input) });
  return asJson(res);
}

export async function updateUser(
  id: string,
  input: Partial<{
    email: string;
    displayName: string;
    status: UserStatus;
    roleIds: string[];
    groupIds: string[];
  }>,
): Promise<{ user: AuthUser }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/users/${id}`, { method: 'PUT', headers, body: JSON.stringify(input) });
  return asJson(res);
}

export async function deleteUser(id: string): Promise<void> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/users/${id}`, { method: 'DELETE', headers });
  await asJson(res);
}

export async function adminResetPassword(
  id: string,
  input: { newPassword?: string; mustChangePassword?: boolean } = {},
): Promise<{ temporaryPassword?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/users/${id}/reset-password`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  return asJson(res);
}

export async function setUserStatus(id: string, status: UserStatus): Promise<void> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/users/${id}/status`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ status }),
  });
  await asJson(res);
}

export async function forcePasswordChange(id: string): Promise<void> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/users/${id}/force-password-change`, { method: 'POST', headers });
  await asJson(res);
}

// ── Groups ────────────────────────────────────────────────────────────────

export async function fetchGroups(): Promise<{ groups: AuthGroup[] }> {
  const res = await mastyfAiFetch('/api/groups');
  return asJson(res);
}

export async function createGroup(input: {
  name: string;
  description?: string;
  roleIds?: string[];
  memberIds?: string[];
}): Promise<{ group: AuthGroup }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/groups', { method: 'POST', headers, body: JSON.stringify(input) });
  return asJson(res);
}

export async function updateGroup(
  id: string,
  input: Partial<{ name: string; description: string; roleIds: string[]; memberIds: string[] }>,
): Promise<{ group: AuthGroup }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/groups/${id}`, { method: 'PUT', headers, body: JSON.stringify(input) });
  return asJson(res);
}

export async function deleteGroup(id: string): Promise<void> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/groups/${id}`, { method: 'DELETE', headers });
  await asJson(res);
}

// ── Roles & permissions ──────────────────────────────────────────────────

export async function fetchRoles(): Promise<{ roles: AuthRole[] }> {
  const res = await mastyfAiFetch('/api/roles');
  return asJson(res);
}

export async function fetchPermissions(): Promise<{ permissions: AuthPermissionDef[] }> {
  const res = await mastyfAiFetch('/api/permissions');
  return asJson(res);
}

export async function createRole(input: {
  name: string;
  description?: string;
  dashboardTier: AuthRole['dashboardTier'];
  permissions: string[];
}): Promise<{ role: AuthRole }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/roles', { method: 'POST', headers, body: JSON.stringify(input) });
  return asJson(res);
}

export async function updateRole(
  id: string,
  input: Partial<{ name: string; description: string; dashboardTier: AuthRole['dashboardTier']; permissions: string[] }>,
): Promise<{ role: AuthRole }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/roles/${id}`, { method: 'PUT', headers, body: JSON.stringify(input) });
  return asJson(res);
}

export async function deleteRole(id: string): Promise<void> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/roles/${id}`, { method: 'DELETE', headers });
  await asJson(res);
}

// ── Audit log ────────────────────────────────────────────────────────────

export async function fetchAuditLogs(params: {
  userId?: string;
  action?: string;
  result?: 'success' | 'failure';
  limit?: number;
  offset?: number;
} = {}): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await mastyfAiFetch(`/api/audit-logs${suffix}`);
  return asJson(res);
}

// ── Auth settings ────────────────────────────────────────────────────────

export async function fetchAuthSettings(): Promise<{ settings: AuthSettings }> {
  const res = await mastyfAiFetch('/api/settings/auth');
  return asJson(res);
}

export async function updateAuthSettings(partial: Partial<AuthSettings>): Promise<{ settings: AuthSettings }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/settings/auth', { method: 'PUT', headers, body: JSON.stringify(partial) });
  return asJson(res);
}

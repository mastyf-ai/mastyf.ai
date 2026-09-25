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
    dashboardRoles: string[];
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
export declare const AUDIT_ACTIONS: {
    readonly LOGIN_SUCCESS: "auth.login.success";
    readonly LOGIN_FAILURE: "auth.login.failure";
    readonly LOGOUT: "auth.logout";
    readonly SETUP_COMPLETE: "auth.setup.complete";
    readonly PASSWORD_CHANGE: "auth.password.change";
    readonly PASSWORD_RESET_BY_ADMIN: "auth.password.reset_by_admin";
    readonly FORCE_PASSWORD_CHANGE: "auth.password.force_change_flag";
    readonly ACCOUNT_LOCKED: "auth.account.locked";
    readonly ACCOUNT_UNLOCKED: "auth.account.unlocked";
    readonly ACCOUNT_DISABLED: "auth.account.disabled";
    readonly ACCOUNT_ENABLED: "auth.account.enabled";
    readonly USER_CREATED: "user.created";
    readonly USER_UPDATED: "user.updated";
    readonly USER_DELETED: "user.deleted";
    readonly GROUP_CREATED: "group.created";
    readonly GROUP_UPDATED: "group.updated";
    readonly GROUP_DELETED: "group.deleted";
    readonly ROLE_CREATED: "role.created";
    readonly ROLE_UPDATED: "role.updated";
    readonly ROLE_DELETED: "role.deleted";
    readonly SESSION_REVOKED: "session.revoked";
    readonly SETTINGS_UPDATED: "settings.updated";
};
//# sourceMappingURL=rbac-types.d.ts.map
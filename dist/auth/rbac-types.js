/**
 * Types for the database-backed authentication & RBAC subsystem.
 * (Distinct from src/auth/auth-types.ts, which covers OAuth/OIDC identity
 * for MCP agent clients — this file covers human dashboard users.)
 */
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
};
//# sourceMappingURL=rbac-types.js.map
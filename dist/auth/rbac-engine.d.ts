import type { AuthUserWithAccess, AuthUser } from './rbac-types.js';
/**
 * Compute a user's effective access: union of permissions from roles
 * assigned directly to the user, plus roles inherited from any group the
 * user belongs to. Also derives the coarse DashboardRole tier array the
 * existing frontend (`lib/dashboard-roles.ts`) already knows how to gate
 * on, so legacy panels keep working without modification.
 */
export declare function resolveUserAccess(user: AuthUser): Promise<AuthUserWithAccess>;
export declare function userHasPermission(userId: string, tenantId: string, permission: string): Promise<boolean>;
//# sourceMappingURL=rbac-engine.d.ts.map
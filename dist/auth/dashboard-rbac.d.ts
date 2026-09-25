export type DashboardRole = 'viewer' | 'analyst' | 'operator' | 'admin' | 'tenant-admin';
export declare const DASHBOARD_ROLE_ORDER: DashboardRole[];
export declare function normalizeDashboardRole(raw: string): DashboardRole | null;
/** Parse MASTYF_AI_DASHBOARD_ROLES env (comma map or JSON object). */
export declare function parseDashboardRolesEnv(raw?: string): Map<string, DashboardRole>;
export declare function roleRank(role: DashboardRole): number;
export declare function hasAtLeastRole(actual: DashboardRole, required: DashboardRole): boolean;
export type DashboardRoutePermission = 'read' | 'export' | 'policy_test' | 'policy_mutate' | 'admin' | 'ai';
export declare function permissionForRoute(method: string, url: string): DashboardRoutePermission | null;
export declare function canAccessRoute(roles: DashboardRole[], method: string, url: string): {
    allowed: boolean;
    required?: DashboardRoutePermission;
    reason?: string;
};
export declare function resolveRolesFromSessionPayload(payload: {
    roles?: string[];
    role?: string;
    [key: string]: unknown;
}): DashboardRole[];
export declare function resolveRolesForApiKey(apiKey: string, mapping?: Map<string, DashboardRole>): DashboardRole[];
/** True when `presented` is the provisioned appliance key or an explicit mapped key. */
export declare function isKnownDashboardApiKey(presented: string): boolean;
/** Map IdP group claim to dashboard roles via MASTYF_AI_DASHBOARD_SSO_ROLE_MAP JSON. */
export declare function resolveSsoRolesFromClaims(claims: Record<string, unknown>): DashboardRole[];
/** tenant-admin may only act within session tenant. */
export declare function assertTenantAdminScope(roles: DashboardRole[], sessionTenantId: string | undefined, requestTenantId: string): {
    ok: boolean;
    reason?: string;
};
//# sourceMappingURL=dashboard-rbac.d.ts.map
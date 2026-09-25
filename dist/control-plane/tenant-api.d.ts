/** Org/fleet RBAC — TrueFoundry-table-stakes surface for install + approve. */
export interface FleetIdentityPolicy {
    /** Roles allowed to install / mediate MCP servers */
    installRoles: string[];
    /** Roles allowed to approve escalations / grants */
    approveRoles: string[];
    allowedServers: string[];
    allowedTools: string[];
    allowedDataLabels: string[];
    allowedDestinations: string[];
}
export type FleetAction = 'install' | 'approve' | 'mutate';
export interface FleetPermissionResult {
    allowed: boolean;
    reason: string;
    required: string[];
    status: 'ALLOWED' | 'DENIED' | 'UNAVAILABLE';
}
export interface TenantRecord {
    id: string;
    displayName: string;
    policyPath: string;
    dailyBudgetUsd?: number;
    /** OS6 fleet identity — optional until org configures it */
    fleet?: FleetIdentityPolicy;
    createdAt: string;
    updatedAt: string;
}
export declare const DEFAULT_FLEET_IDENTITY: FleetIdentityPolicy;
export declare function getFleetIdentity(tenantId: string): FleetIdentityPolicy | null;
export declare function setFleetIdentity(tenantId: string, fleet: FleetIdentityPolicy): TenantRecord;
/**
 * Evaluate whether a role may perform an org action against fleet policy.
 * No fleet policy → UNAVAILABLE (caller decides; gateway mutate treats as allow-with-note when unset).
 */
export declare function evaluateFleetPermission(params: {
    tenantId: string;
    role: string | undefined | null;
    action: FleetAction;
    server?: string;
    tool?: string;
    destination?: string;
    dataLabel?: string;
}): FleetPermissionResult;
export declare function listTenants(): TenantRecord[];
export declare function getTenant(id: string): TenantRecord | null;
export declare function createTenant(input: {
    id: string;
    displayName: string;
    policyYaml?: string;
    dailyBudgetUsd?: number;
}): TenantRecord;
export declare function updateTenantPolicy(id: string, policyYaml: string): TenantRecord;
export declare function deleteTenant(id: string): void;
export declare function registerTenantApiRoutes(app: {
    get: Function;
    post: Function;
    put: Function;
    delete: Function;
}): void;
//# sourceMappingURL=tenant-api.d.ts.map
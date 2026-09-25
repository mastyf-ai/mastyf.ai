import type { AuthPermissionDef, AuthRole, DashboardTier } from './rbac-types.js';
export declare const permissionCatalog: {
    list(): Promise<AuthPermissionDef[]>;
    /** Validate a list of permission keys against the known catalog. */
    filterValid(keys: string[]): Promise<string[]>;
};
export declare const roleStore: {
    /** Seed the five system roles + permission catalog if the tables are empty (SQLite has no SQL-file seed). */
    ensureSeeded(tenantId?: string): Promise<void>;
    list(tenantId?: string): Promise<AuthRole[]>;
    findById(id: string, tenantId?: string): Promise<AuthRole | null>;
    findByDashboardTier(tier: DashboardTier, tenantId?: string): Promise<AuthRole | null>;
    create(input: {
        tenantId?: string;
        name: string;
        description?: string;
        dashboardTier: DashboardTier;
        permissions: string[];
    }): Promise<AuthRole>;
    update(id: string, input: {
        name?: string;
        description?: string;
        dashboardTier?: DashboardTier;
        permissions?: string[];
    }, tenantId?: string): Promise<AuthRole | null>;
    delete(id: string, tenantId?: string): Promise<boolean>;
    assignToUser(userId: string, roleId: string, assignedBy?: string | null): Promise<void>;
    removeFromUser(userId: string, roleId: string): Promise<void>;
    setUserRoles(userId: string, roleIds: string[], assignedBy?: string | null): Promise<void>;
    rolesForUser(userId: string): Promise<AuthRole[]>;
};
//# sourceMappingURL=role-store.d.ts.map
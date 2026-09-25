import type { DashboardRole } from '../auth/dashboard-rbac.js';
export type CloudSessionPayload = {
    tenantSlug: string;
    identity: string;
    roles: string[];
    exp: number;
};
export declare function verifyCloudSessionToken(token: string): CloudSessionPayload | null;
export declare function mapCloudRoles(roles: string[]): DashboardRole[];
//# sourceMappingURL=cloud-session.d.ts.map
import type { DashboardRole } from '../auth/dashboard-rbac.js';
export type CloudSessionPayload = {
    tenantSlug: string;
    identity: string;
    roles: string[];
    exp: number;
};
/**
 * The session the control plane returned from /api/v1/license/exchange. It arrives over the
 * proxy's own API-key-authenticated HTTPS call, so it needs no signature check; this only
 * rejects malformed or expired claims and, when this host is pinned to a workspace
 * (MASTYF_AI_TENANT_ID), claims for a different one.
 */
export declare function cloudSessionFromClaims(claims: unknown, expectedTenant?: string | undefined): CloudSessionPayload | null;
/**
 * Legacy: control planes before API-key exchange returned an HMAC-signed session that this
 * host could only check by holding the cloud's own secret. Kept so an older self-hosted
 * control plane still works; mastyf.ai Cloud no longer sends these.
 */
export declare function verifyCloudSessionToken(token: string): CloudSessionPayload | null;
export declare function mapCloudRoles(roles: string[]): DashboardRole[];
//# sourceMappingURL=cloud-session.d.ts.map
export declare function jwtTenantClaimName(): string;
/** Extract tenant id from a verified JWT payload object. */
export declare function extractTenantFromJwtPayload(payload: Record<string, unknown>): string | undefined;
/**
 * When multi-tenant mode is enabled, reject requests where the resolved tenant
 * header/meta does not match the JWT tenant claim (if present on the token).
 */
export declare function validateJwtTenantBinding(requestTenantId: string, jwtTenantId?: string): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export declare class JwtTenantRequiredError extends Error {
    constructor(message: string);
}
/**
 * Resolve tenant for an authenticated request in multi-tenant mode.
 * JWT claim is authoritative; header/meta must not disagree.
 */
export declare function resolveAuthenticatedTenant(opts: {
    jwtTenantId?: string;
    headerTenant?: string;
    metaTenant?: string;
    authenticated: boolean;
}): {
    tenantId: string;
    source: 'jwt' | 'header' | 'env';
};
export declare function extractRequestTenantHints(sources?: {
    headers?: Record<string, string | string[] | undefined>;
    meta?: unknown;
}): {
    header?: string;
    meta?: string;
};
/** Resolve tenant for proxy paths (stdio, HTTP, SSE, WS). */
export declare function resolveProxyTenantId(opts: {
    headers?: Record<string, string | string[] | undefined>;
    meta?: unknown;
    jwtTenantId?: string;
    authenticated: boolean;
}): string;
//# sourceMappingURL=jwt-tenant-binding.d.ts.map
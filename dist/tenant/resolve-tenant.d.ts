export declare const DEFAULT_TENANT_ID = "default";
export declare const MAX_TENANT_ID_LENGTH = 64;
export type TenantContext = {
    tenantId: string;
    source: 'env' | 'header';
};
export declare class InvalidTenantIdError extends Error {
    constructor(message: string);
}
/** Validate and normalize a tenant identifier (rejects empty, path traversal, invalid chars). */
export declare function validateTenantId(raw: string): string;
/** Extract tenant from HTTP headers (case-insensitive keys). */
export declare function extractTenantHeader(headers?: Record<string, string | string[] | undefined>): string | undefined;
export declare function resolveTenantContext(sources?: {
    header?: string | string[] | undefined;
    headers?: Record<string, string | string[] | undefined>;
    meta?: unknown;
}): TenantContext;
/** Resolve tenant id — env default when no request-scoped source is present. */
export declare function resolveTenantId(sources?: {
    header?: string | string[] | undefined;
    headers?: Record<string, string | string[] | undefined>;
    meta?: unknown;
}): string;
/** CLI/batch jobs with no HTTP headers — uses MASTYF_AI_TENANT_ID or `default`. */
export declare function resolveTenantFromEnv(): string;
/**
 * Resolve tenant for CLI batch scans. Prefers `--tenant`, then MASTYF_AI_TENANT_ID.
 * When MASTYF_AI_MULTI_TENANT_ENABLED=true, requires an explicit tenant via flag or env.
 */
export declare function resolveCliTenantId(opts?: {
    tenant?: string;
}): string;
/** Prefix Redis/in-process rate-limit keys with tenant namespace. */
export declare function tenantRateLimitKey(tenantId: string, key: string): string;
/** Whether multi-tenant header routing is enabled (shared gateway mode). */
export declare function isMultiTenantModeEnabled(): boolean;
export declare function resolveTenantPolicyPath(tenantId: string, baseDir?: string): string;
//# sourceMappingURL=resolve-tenant.d.ts.map
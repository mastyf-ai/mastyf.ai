import { existsSync } from 'fs';
export const DEFAULT_TENANT_ID = 'default';
export const MAX_TENANT_ID_LENGTH = 64;
/** Alphanumeric + hyphen; must start/end with alphanumeric. */
const TENANT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,62}[a-zA-Z0-9])?$/;
export class InvalidTenantIdError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidTenantIdError';
    }
}
/** Validate and normalize a tenant identifier (rejects empty, path traversal, invalid chars). */
export function validateTenantId(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new InvalidTenantIdError('Tenant id must not be empty');
    }
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
        throw new InvalidTenantIdError('Tenant id must not contain path traversal sequences');
    }
    if (trimmed.length > MAX_TENANT_ID_LENGTH) {
        throw new InvalidTenantIdError(`Tenant id exceeds max length of ${MAX_TENANT_ID_LENGTH}`);
    }
    if (!TENANT_ID_PATTERN.test(trimmed)) {
        throw new InvalidTenantIdError('Tenant id must be alphanumeric with optional internal hyphens');
    }
    return trimmed;
}
/** Extract tenant from HTTP headers (case-insensitive keys). */
export function extractTenantHeader(headers) {
    if (!headers)
        return undefined;
    const normalized = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    for (const key of ['x-mastyf-ai-tenant', 'x-tenant-id']) {
        const val = normalized[key];
        if (typeof val === 'string' && val.trim())
            return val.trim();
        if (Array.isArray(val) && val[0])
            return String(val[0]).trim();
    }
    return undefined;
}
export function resolveTenantContext(sources) {
    let fromRequest;
    if (sources?.header) {
        fromRequest = Array.isArray(sources.header) ? sources.header[0] : sources.header;
    }
    else if (sources?.headers) {
        fromRequest = extractTenantHeader(sources.headers);
    }
    const meta = sources?.meta;
    if (!fromRequest && meta?.tenantId && typeof meta.tenantId === 'string') {
        fromRequest = meta.tenantId;
    }
    if (fromRequest?.trim()) {
        return { tenantId: validateTenantId(fromRequest), source: 'header' };
    }
    const envRaw = process.env['MASTYF_AI_TENANT_ID'] || DEFAULT_TENANT_ID;
    try {
        return { tenantId: validateTenantId(envRaw), source: 'env' };
    }
    catch {
        return { tenantId: DEFAULT_TENANT_ID, source: 'env' };
    }
}
/** Resolve tenant id — env default when no request-scoped source is present. */
export function resolveTenantId(sources) {
    return resolveTenantContext(sources).tenantId;
}
/** CLI/batch jobs with no HTTP headers — uses MASTYF_AI_TENANT_ID or `default`. */
export function resolveTenantFromEnv() {
    return resolveTenantId();
}
/**
 * Resolve tenant for CLI batch scans. Prefers `--tenant`, then MASTYF_AI_TENANT_ID.
 * When MASTYF_AI_MULTI_TENANT_ENABLED=true, requires an explicit tenant via flag or env.
 */
export function resolveCliTenantId(opts) {
    const fromFlag = opts?.tenant?.trim();
    if (fromFlag) {
        return validateTenantId(fromFlag);
    }
    const envSet = Boolean(process.env['MASTYF_AI_TENANT_ID']?.trim());
    if (isMultiTenantModeEnabled() && !envSet) {
        throw new InvalidTenantIdError('Multi-tenant mode requires --tenant <id> or MASTYF_AI_TENANT_ID for batch scans');
    }
    return resolveTenantFromEnv();
}
/** Prefix Redis/in-process rate-limit keys with tenant namespace. */
export function tenantRateLimitKey(tenantId, key) {
    const tid = tenantId?.trim() || DEFAULT_TENANT_ID;
    return `tenant:${tid}:${key}`;
}
/** Whether multi-tenant header routing is enabled (shared gateway mode). */
export function isMultiTenantModeEnabled() {
    return process.env['MASTYF_AI_MULTI_TENANT_ENABLED'] === 'true';
}
export function resolveTenantPolicyPath(tenantId, baseDir) {
    const root = baseDir || process.env['MASTYF_AI_POLICY_ROOT'] || '.';
    if (tenantId === DEFAULT_TENANT_ID) {
        return process.env['MASTYF_AI_POLICY_PATH'] || `${root}/default-policy.yaml`;
    }
    const templatePath = `${root}/policy-templates/tenants/${tenantId}/policy.yaml`;
    const legacyPath = `${root}/policies/${tenantId}/policy.yaml`;
    if (existsSync(templatePath))
        return templatePath;
    if (existsSync(legacyPath))
        return legacyPath;
    return templatePath;
}
//# sourceMappingURL=resolve-tenant.js.map
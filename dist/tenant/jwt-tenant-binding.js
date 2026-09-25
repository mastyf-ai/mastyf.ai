/**
 * JWT tenant claim binding — request tenant must match token claim in multi-tenant mode.
 */
import { isMultiTenantModeEnabled, validateTenantId, InvalidTenantIdError, resolveTenantContext, extractTenantHeader, } from './resolve-tenant.js';
import { getLicenseClient } from '../license/license-client.js';
import { isOpenCoreEnabled } from '../license/feature-tiers.js';
export function jwtTenantClaimName() {
    return process.env['MASTYF_AI_JWT_TENANT_CLAIM'] || 'tenant_id';
}
/** Extract tenant id from a verified JWT payload object. */
export function extractTenantFromJwtPayload(payload) {
    const claim = jwtTenantClaimName();
    const raw = payload[claim] ?? payload['tenantId'];
    if (raw === undefined || raw === null)
        return undefined;
    const s = String(raw).trim();
    return s.length > 0 ? s : undefined;
}
/**
 * When multi-tenant mode is enabled, reject requests where the resolved tenant
 * header/meta does not match the JWT tenant claim (if present on the token).
 */
export function validateJwtTenantBinding(requestTenantId, jwtTenantId) {
    if (!isMultiTenantModeEnabled()) {
        return { ok: true };
    }
    if (!jwtTenantId) {
        return { ok: true };
    }
    if (jwtTenantId !== requestTenantId) {
        return {
            ok: false,
            reason: `Tenant mismatch: request tenant '${requestTenantId}' does not match JWT claim '${jwtTenantId}'`,
        };
    }
    return { ok: true };
}
export class JwtTenantRequiredError extends Error {
    constructor(message) {
        super(message);
        this.name = 'JwtTenantRequiredError';
    }
}
/**
 * Resolve tenant for an authenticated request in multi-tenant mode.
 * JWT claim is authoritative; header/meta must not disagree.
 */
export function resolveAuthenticatedTenant(opts) {
    const headerOrMeta = opts.headerTenant?.trim() || opts.metaTenant?.trim();
    if (!isMultiTenantModeEnabled()) {
        if (opts.jwtTenantId) {
            try {
                const tid = validateTenantId(opts.jwtTenantId);
                if (headerOrMeta && headerOrMeta !== tid) {
                    throw new JwtTenantRequiredError(`Tenant mismatch: request tenant '${headerOrMeta}' does not match JWT claim '${tid}'`);
                }
                return { tenantId: tid, source: 'jwt' };
            }
            catch (err) {
                if (err instanceof InvalidTenantIdError)
                    throw err;
                throw err;
            }
        }
        if (headerOrMeta) {
            return { tenantId: validateTenantId(headerOrMeta), source: 'header' };
        }
        const ctx = resolveTenantContext();
        return { tenantId: ctx.tenantId, source: ctx.source === 'header' ? 'header' : 'env' };
    }
    if (opts.authenticated) {
        if (!opts.jwtTenantId?.trim()) {
            throw new JwtTenantRequiredError(`Multi-tenant mode requires JWT claim '${jwtTenantClaimName()}' on authenticated requests`);
        }
        const tid = validateTenantId(opts.jwtTenantId);
        if (headerOrMeta && headerOrMeta !== tid) {
            throw new JwtTenantRequiredError(`Tenant mismatch: request tenant '${headerOrMeta}' does not match JWT claim '${tid}'`);
        }
        return { tenantId: tid, source: 'jwt' };
    }
    if (headerOrMeta) {
        return { tenantId: validateTenantId(headerOrMeta), source: 'header' };
    }
    const ctx = resolveTenantContext();
    return { tenantId: ctx.tenantId, source: ctx.source === 'header' ? 'header' : 'env' };
}
export function extractRequestTenantHints(sources) {
    const meta = sources?.meta;
    const header = sources?.headers ? extractTenantHeader(sources.headers) : undefined;
    const metaTenant = typeof meta?.tenantId === 'string' ? meta.tenantId : undefined;
    return { header, meta: metaTenant };
}
/** Resolve tenant for proxy paths (stdio, HTTP, SSE, WS). */
export function resolveProxyTenantId(opts) {
    if (isMultiTenantModeEnabled() && isOpenCoreEnabled()) {
        if (!getLicenseClient().hasFeature('multi_tenant')) {
            throw new JwtTenantRequiredError('Multi-tenant mode requires linking to mastyf.ai Cloud (set MASTYF_AI_CONTROL_PLANE_URL and API key)');
        }
    }
    const hints = extractRequestTenantHints({ headers: opts.headers, meta: opts.meta });
    return resolveAuthenticatedTenant({
        jwtTenantId: opts.jwtTenantId,
        headerTenant: hints.header,
        metaTenant: hints.meta,
        authenticated: opts.authenticated,
    }).tenantId;
}
//# sourceMappingURL=jwt-tenant-binding.js.map
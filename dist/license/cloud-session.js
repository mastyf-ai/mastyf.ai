import { createHmac, timingSafeEqual } from 'crypto';
/**
 * The session the control plane returned from /api/v1/license/exchange. It arrives over the
 * proxy's own API-key-authenticated HTTPS call, so it needs no signature check; this only
 * rejects malformed or expired claims and, when this host is pinned to a workspace
 * (MASTYF_AI_TENANT_ID), claims for a different one.
 */
export function cloudSessionFromClaims(claims, expectedTenant = process.env['MASTYF_AI_TENANT_ID']?.trim() || undefined) {
    if (!claims || typeof claims !== 'object')
        return null;
    const c = claims;
    if (typeof c.tenantSlug !== 'string' || !c.tenantSlug)
        return null;
    if (typeof c.identity !== 'string' || !c.identity)
        return null;
    if (typeof c.exp !== 'number' || c.exp < Math.floor(Date.now() / 1000))
        return null;
    if (expectedTenant && c.tenantSlug !== expectedTenant)
        return null;
    const roles = Array.isArray(c.roles) ? c.roles.filter((r) => typeof r === 'string') : [];
    return { tenantSlug: c.tenantSlug, identity: c.identity, roles, exp: c.exp };
}
/**
 * Legacy: control planes before API-key exchange returned an HMAC-signed session that this
 * host could only check by holding the cloud's own secret. Kept so an older self-hosted
 * control plane still works; mastyf.ai Cloud no longer sends these.
 */
export function verifyCloudSessionToken(token) {
    const secret = process.env['MASTYF_AI_CLOUD_JWT_SECRET'] ??
        process.env['LICENSE_JWT_SECRET'] ??
        process.env['DASHBOARD_JWT_SECRET'];
    if (!secret)
        return null;
    const parts = token.split('.');
    if (parts.length !== 2)
        return null;
    const [encoded, sig] = parts;
    const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
    try {
        if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
            return null;
    }
    catch {
        return null;
    }
    try {
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (payload.exp < Math.floor(Date.now() / 1000))
            return null;
        if (!payload.tenantSlug || !payload.identity)
            return null;
        return payload;
    }
    catch {
        return null;
    }
}
export function mapCloudRoles(roles) {
    const allowed = new Set([
        'viewer',
        'analyst',
        'operator',
        'admin',
        'tenant-admin',
    ]);
    const mapped = roles.filter((r) => allowed.has(r));
    return mapped.length > 0 ? mapped : ['tenant-admin'];
}
//# sourceMappingURL=cloud-session.js.map
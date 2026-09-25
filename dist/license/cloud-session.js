import { createHmac, timingSafeEqual } from 'crypto';
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
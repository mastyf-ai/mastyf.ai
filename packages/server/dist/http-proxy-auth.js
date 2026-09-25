function defaultExtractToken(authHeader) {
    if (!authHeader)
        return null;
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}
export async function runHttpProxyAuthGate(req, validator) {
    const authHeader = req.headers['authorization'];
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const extract = validator.extractToken ?? defaultExtractToken;
    const token = extract(headerValue);
    if (!token && validator.getConfig().required) {
        return { ok: false, status: 401, message: 'Authentication required' };
    }
    if (token) {
        const result = await validator.validate(token);
        if (!result.valid && validator.getConfig().required) {
            return {
                ok: false,
                status: 403,
                message: `Authentication failed: ${result.error ?? 'invalid token'}`,
            };
        }
    }
    return { ok: true };
}
export function sendAuthGateFailure(res, failure) {
    if (res.headersSent)
        return;
    res.writeHead(failure.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: failure.message }));
}

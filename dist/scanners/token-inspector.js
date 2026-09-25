const JWT_REGEX = /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{5,}/g;
/** Decode a base64url JWT segment (header or payload). */
function decodeJwtSegment(segment) {
    try {
        // Base64url → Base64 → UTF-8
        const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(base64, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    }
    catch {
        return null;
    }
}
/** Inspect JWT header for algorithm manipulation (alg:none, alg:HS256 bypass). */
function inspectJwtHeader(header) {
    const results = [];
    const alg = header['alg'];
    if (alg === 'none') {
        results.push({
            detected: true,
            category: 'jwt-manipulation',
            severity: 'critical',
            message: 'JWT algorithm set to "none" — signature bypass attempt',
            evidence: 'alg: none',
            confidence: 1.0,
        });
    }
    if (typeof alg === 'string' && alg.toUpperCase() === 'HS256' && header['jwk']) {
        results.push({
            detected: true,
            category: 'jwt-manipulation',
            severity: 'critical',
            message: 'JWT HS256 with embedded JWK — key confusion attack',
            evidence: `alg: ${alg}, jwk present`,
            confidence: 0.95,
        });
    }
    return results;
}
/** Inspect JWT payload for privilege escalation claims. */
function inspectJwtPayload(payload) {
    const results = [];
    // Admin / privilege escalation
    if (payload['admin'] === true || payload['role'] === 'admin' || payload['isAdmin'] === true) {
        results.push({
            detected: true,
            category: 'jwt-manipulation',
            severity: 'critical',
            message: 'JWT claims contain admin/privilege escalation',
            evidence: `admin=${payload['admin']}, role=${payload['role']}, isAdmin=${payload['isAdmin']}`,
            confidence: 0.9,
        });
    }
    // Expired token
    if (typeof payload['exp'] === 'number' && payload['exp'] < Math.floor(Date.now() / 1000)) {
        results.push({
            detected: true,
            category: 'jwt-manipulation',
            severity: 'warning',
            message: 'JWT token is expired (exp claim in the past)',
            evidence: `exp=${payload['exp']}, now=${Math.floor(Date.now() / 1000)}`,
            confidence: 0.95,
        });
    }
    // Weak issuer
    const iss = String(payload['iss'] || '');
    if (iss && (iss.includes('localhost') || iss.includes('127.0.0.1') || iss === 'none')) {
        results.push({
            detected: true,
            category: 'jwt-manipulation',
            severity: 'warning',
            message: `JWT issuer is suspicious: ${iss}`,
            evidence: `iss=${iss}`,
            confidence: 0.7,
        });
    }
    return results;
}
/** Inspect a SAML assertion for injection or privilege escalation. */
function inspectSamlAssertion(value) {
    const results = [];
    // SAML wrapping attack
    if (value.includes('<saml:Assertion') || value.includes('<samlp:Response')) {
        results.push({
            detected: true,
            category: 'jwt-manipulation',
            severity: 'warning',
            message: 'SAML assertion detected in arguments — verify signature',
            evidence: value.slice(0, 200),
            confidence: 0.7,
        });
    }
    // Role injection in SAML attributes
    if (/<saml:Attribute\s+Name\s*=\s*['"]role['"][^>]*>/i.test(value)) {
        const roleMatch = value.match(/<saml:AttributeValue[^>]*>(.*?)<\/saml:AttributeValue>/i);
        const roleValue = roleMatch?.[1] || 'unknown';
        if (roleValue.toLowerCase() === 'admin' || roleValue.toLowerCase() === 'administrator') {
            results.push({
                detected: true,
                category: 'jwt-manipulation',
                severity: 'critical',
                message: `SAML role injection: attribute "role" set to "${roleValue}"`,
                evidence: value.slice(0, 200),
                confidence: 0.9,
            });
        }
    }
    return results;
}
/** Recursive token inspection: walk all string leaves and inspect JWT/SAML. */
export function runTokenInspection(flat) {
    const results = [];
    for (const item of flat) {
        // ── JWT tokens ──────────────────────────────────────────────────
        const jwtMatches = item.value.matchAll(JWT_REGEX);
        for (const match of jwtMatches) {
            const token = match[0];
            const parts = token.split('.');
            if (parts.length !== 3)
                continue;
            const header = decodeJwtSegment(parts[0]);
            if (header) {
                results.push(...inspectJwtHeader(header));
            }
            const payload = decodeJwtSegment(parts[1]);
            if (payload) {
                results.push(...inspectJwtPayload(payload));
            }
        }
        // ── SAML assertions ─────────────────────────────────────────────
        if (/(?:saml|assertion|SAMLResponse)/i.test(item.value)) {
            results.push(...inspectSamlAssertion(item.value));
        }
    }
    return results;
}
//# sourceMappingURL=token-inspector.js.map
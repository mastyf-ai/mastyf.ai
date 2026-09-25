import crypto from 'node:crypto';
import * as jose from 'jose';
const DISCOVERY_CACHE = new Map();
const DISCOVERY_TTL_MS = 3_600_000; // 1 hour
async function discoverOidc(issuerUrl) {
    const cached = DISCOVERY_CACHE.get(issuerUrl);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }
    const url = issuerUrl.endsWith('/.well-known/openid-configuration')
        ? issuerUrl
        : `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
        throw new Error(`OIDC discovery failed for ${issuerUrl}: HTTP ${res.status}`);
    }
    const data = (await res.json());
    DISCOVERY_CACHE.set(issuerUrl, { data, expiresAt: Date.now() + DISCOVERY_TTL_MS });
    return data;
}
export function generateState() {
    return crypto.randomBytes(32).toString('base64url');
}
export function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}
export function generateNonce() {
    return crypto.randomBytes(16).toString('base64url');
}
export function computeCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}
export function buildAuthorizationUrl(config, discovery, state, codeChallenge, nonce) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: config.scopes.join(' '),
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });
    return `${discovery.authorization_endpoint}?${params.toString()}`;
}
export async function exchangeCodeForTokens(config, discovery, code, codeVerifier, state) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: codeVerifier,
    });
    const res = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: body.toString(),
    });
    if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`Token exchange failed for provider ${config.name}: HTTP ${res.status} - ${errorBody.slice(0, 200)}`);
    }
    return (await res.json());
}
export function decodeBase64JwtPayload(jwt) {
    const parts = jwt.split('.');
    if (parts.length !== 3)
        throw new Error('Invalid JWT format');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}
export async function validateIdToken(idToken, config, discovery, expectedNonce) {
    const JWKS = jose.createRemoteJWKSet(new URL(discovery.jwks_uri));
    const { payload } = await jose.jwtVerify(idToken, JWKS, {
        issuer: discovery.issuer,
        audience: config.clientId,
        clockTolerance: 60,
    });
    const claims = payload;
    if (!claims.sub) {
        throw new Error('ID token missing sub claim');
    }
    if (claims.nonce && claims.nonce !== expectedNonce) {
        throw new Error('ID token nonce mismatch');
    }
    return claims;
}
export async function fetchUserinfo(discovery, accessToken) {
    if (!discovery.userinfo_endpoint)
        return null;
    const res = await fetch(discovery.userinfo_endpoint, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
        },
    });
    if (!res.ok)
        return null;
    return (await res.json());
}
export function extractFederatedUserData(config, idTokenClaims, userinfo, tokens) {
    const resolveClaim = (claimPath) => {
        const [source, ...parts] = claimPath.split('.');
        const obj = source === 'id_token' ? idTokenClaims : userinfo;
        if (!obj)
            return '';
        let value = obj;
        for (const part of parts) {
            if (value && typeof value === 'object') {
                value = value[part];
            }
            else {
                return '';
            }
        }
        return typeof value === 'string' ? value : '';
    };
    const email = resolveClaim(config.claimMappings.email) || idTokenClaims.email || '';
    const displayName = resolveClaim(config.claimMappings.displayName) || idTokenClaims.name || idTokenClaims.preferred_username || email;
    const groups = config.claimMappings.groups
        ? extractClaimAsArray(config.claimMappings.groups, idTokenClaims, userinfo)
        : (idTokenClaims.groups || []);
    const roles = config.claimMappings.roles
        ? extractClaimAsArray(config.claimMappings.roles, idTokenClaims, userinfo)
        : (idTokenClaims.roles || []);
    const mappedRoles = new Set();
    for (const group of groups) {
        const mapped = config.roleMap[group];
        if (mapped)
            mappedRoles.add(mapped);
    }
    for (const role of roles) {
        const mapped = config.roleMap[role];
        if (mapped)
            mappedRoles.add(mapped);
    }
    return {
        idpProvider: config.id,
        idpUserId: idTokenClaims.sub,
        email,
        displayName: displayName || email,
        groups: groups,
        roles: roles,
        mappedRoles: [...mappedRoles],
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
    };
}
function extractClaimAsArray(claimPath, idTokenClaims, userinfo) {
    const source = claimPath.startsWith('id_token.') ? idTokenClaims : userinfo;
    const key = claimPath.includes('.') ? claimPath.split('.').pop() : claimPath;
    if (!source)
        return [];
    const value = source[key];
    if (Array.isArray(value))
        return value.map(String);
    if (typeof value === 'string')
        return [value];
    return [];
}
export async function startOidcLogin(config) {
    const discovery = await discoverOidc(config.issuerUrl);
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const nonce = generateNonce();
    const codeChallenge = computeCodeChallenge(codeVerifier);
    const authorizationUrl = buildAuthorizationUrl(config, discovery, state, codeChallenge, nonce);
    return { authorizationUrl, state, codeVerifier, nonce };
}
export async function handleOidcCallback(config, code, state, expectedState, codeVerifier, expectedNonce) {
    if (state !== expectedState) {
        throw new Error('OAuth state mismatch — possible CSRF attack');
    }
    const discovery = await discoverOidc(config.issuerUrl);
    const tokens = await exchangeCodeForTokens(config, discovery, code, codeVerifier, state);
    const idTokenClaims = await validateIdToken(tokens.id_token, config, discovery, expectedNonce);
    const userinfo = await fetchUserinfo(discovery, tokens.access_token);
    return extractFederatedUserData(config, idTokenClaims, userinfo, tokens);
}
export { discoverOidc };
//# sourceMappingURL=oidc-provider.js.map
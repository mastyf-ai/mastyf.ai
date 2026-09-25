/**
 * OAuth 2.1 / OIDC JWT Validator for MCP Mastyf AI proxy.
 *
 * Validates bearer tokens from MCP requests against an OIDC provider.
 * Uses OIDC Discovery (RFC 8414) to auto-configure JWKS endpoint.
 * Supports Client Credentials flow (most common for server-to-agent MCP).
 */
import * as jose from 'jose';
import { StructuredLogger } from '../utils/structured-logger.js';
import { extractTenantFromJwtPayload } from '../tenant/jwt-tenant-binding.js';
import { isBearerTokenRevoked } from './token-revocation.js';
import { extractJwtScopes } from './jwt-scopes.js';
export class OAuthValidator {
    config;
    jwks = null;
    cachedDiscovery = null;
    discoveryFetchedAt = 0;
    jwksFetchedAt = 0;
    jwksUri = null;
    backgroundRefreshTimer = null;
    constructor(config) {
        this.config = config;
    }
    discoveryTtlMs() {
        const n = parseInt(process.env['MASTYF_AI_OIDC_DISCOVERY_TTL_MS'] || '3600000', 10);
        return Number.isFinite(n) && n > 60_000 ? n : 3_600_000;
    }
    jwksRefreshMs() {
        const n = parseInt(process.env['MASTYF_AI_JWKS_REFRESH_MS'] || '300000', 10);
        return Number.isFinite(n) && n >= 60_000 ? n : 300_000;
    }
    isJwksStale() {
        if (!this.jwks)
            return true;
        return Date.now() - this.jwksFetchedAt >= this.jwksRefreshMs();
    }
    refreshJwksFromUri(jwksUri) {
        this.jwks = jose.createRemoteJWKSet(new URL(jwksUri));
        this.jwksUri = jwksUri;
        this.jwksFetchedAt = Date.now();
    }
    /** Refresh discovery + JWKS when TTL elapsed (before each validate). */
    async ensureJwksFresh(force = false) {
        if (!force && !this.isJwksStale() && this.jwks)
            return;
        let jwksUri = this.config.jwksUri;
        if (!jwksUri || force) {
            const discovery = await this.discover(force);
            jwksUri = discovery.jwks_uri;
        }
        else if (!this.jwks) {
            this.jwksUri = jwksUri;
        }
        if (!jwksUri) {
            throw new Error('JWKS URI not available from discovery or config');
        }
        if (force || !this.jwks || this.jwksUri !== jwksUri) {
            this.refreshJwksFromUri(jwksUri);
            StructuredLogger.info({ event: 'jwks_refreshed', jwks_uri: jwksUri, forced: force });
        }
        else {
            this.jwksFetchedAt = Date.now();
        }
    }
    /** Optional background JWKS refresh (call once after proxy OAuth init). */
    startBackgroundJwksRefresh() {
        if (this.backgroundRefreshTimer)
            return;
        const interval = this.jwksRefreshMs();
        this.backgroundRefreshTimer = setInterval(() => {
            void this.ensureJwksFresh(false).catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                StructuredLogger.logError({ event: 'oidc_discovery_error', serverName: 'oauth', error: `jwks refresh: ${msg}` });
            });
        }, interval);
        if (typeof this.backgroundRefreshTimer.unref === 'function') {
            this.backgroundRefreshTimer.unref();
        }
    }
    stopBackgroundJwksRefresh() {
        if (this.backgroundRefreshTimer) {
            clearInterval(this.backgroundRefreshTimer);
            this.backgroundRefreshTimer = null;
        }
    }
    isJwksSignatureError(err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = err?.code;
        return (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ||
            code === 'ERR_JWKS_NO_MATCHING_KEY' ||
            /no matching key|signature verification failed/i.test(msg));
    }
    /**
     * Perform OIDC discovery to fetch JWKS URI from issuer (TTL-refreshed).
     */
    async discover(force = false) {
        const ttl = this.discoveryTtlMs();
        if (!force &&
            this.cachedDiscovery &&
            Date.now() - this.discoveryFetchedAt < ttl) {
            return this.cachedDiscovery;
        }
        const discoveryUrl = `${this.config.issuer}/.well-known/openid-configuration`;
        try {
            const res = await fetch(discoveryUrl);
            if (!res.ok)
                throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
            const meta = (await res.json());
            this.cachedDiscovery = meta;
            this.discoveryFetchedAt = Date.now();
            this.jwksUri = meta.jwks_uri;
            if (meta.jwks_uri) {
                this.refreshJwksFromUri(meta.jwks_uri);
            }
            StructuredLogger.info({ event: 'oidc_discovery', issuer: this.config.issuer, jwks_uri: meta.jwks_uri });
            return meta;
        }
        catch (err) {
            StructuredLogger.logError({ event: 'oidc_discovery_error', serverName: 'oauth', error: `Failed to discover OIDC config: ${err instanceof Error ? err.message : String(err)}` });
            throw err;
        }
    }
    /**
     * Initialize JWKS from discovery or explicit URI.
     */
    async init() {
        let jwksUri = this.config.jwksUri;
        if (!jwksUri) {
            const discovery = await this.discover();
            jwksUri = discovery.jwks_uri;
        }
        else {
            this.jwksUri = jwksUri;
        }
        if (!this.jwks || this.jwksUri !== jwksUri) {
            this.refreshJwksFromUri(jwksUri);
        }
    }
    async verifyToken(token) {
        if (!this.jwks)
            throw new Error('JWKS not initialized');
        const ALLOWED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'PS256'];
        const maxLifetimeSec = parseInt(process.env['MASTYF_AI_JWT_MAX_LIFETIME_SEC'] || '86400', 10);
        const { payload } = await jose.jwtVerify(token, this.jwks, {
            issuer: this.config.issuer,
            audience: this.config.audience,
            algorithms: ALLOWED_ALGORITHMS,
            clockTolerance: this.config.clockTolerance || 30,
            maxTokenAge: Number.isFinite(maxLifetimeSec) && maxLifetimeSec > 0 ? `${maxLifetimeSec}s` : '24h',
        });
        return payload;
    }
    /**
     * Validate a JWT bearer token and extract agent identity.
     */
    async validate(token) {
        try {
            await this.ensureJwksFresh(false);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { valid: false, error: `Auth provider unreachable: ${msg}` };
        }
        if (!this.jwks) {
            return { valid: false, error: 'JWKS not initialized' };
        }
        let payload;
        try {
            payload = await this.verifyToken(token);
        }
        catch (err) {
            if (this.isJwksSignatureError(err)) {
                try {
                    await this.ensureJwksFresh(true);
                    payload = await this.verifyToken(token);
                }
                catch (retryErr) {
                    const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                    return { valid: false, error: `JWT validation failed after JWKS refresh: ${msg}` };
                }
            }
            else {
                const msg = err instanceof Error ? err.message : String(err);
                return { valid: false, error: `JWT validation failed: ${msg}` };
            }
        }
        try {
            if (!payload.sub) {
                return { valid: false, error: 'JWT missing required sub claim' };
            }
            const payloadRecord = payload;
            const jti = typeof payload.jti === 'string' ? payload.jti : undefined;
            if (await isBearerTokenRevoked(token, jti)) {
                return { valid: false, error: 'Token has been revoked' };
            }
            const introspect = await this.introspectTokenActive(token);
            if (introspect === false) {
                return { valid: false, error: 'Token inactive per OIDC introspection' };
            }
            const identity = {
                sub: payload.sub,
                clientId: payloadRecord.client_id || payloadRecord.azp,
                scopes: extractJwtScopes(payloadRecord),
                issuer: payload.iss || this.config.issuer,
                expiresAt: payload.exp ? payload.exp * 1000 : undefined,
                tenantId: extractTenantFromJwtPayload(payloadRecord),
            };
            return { valid: true, identity };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { valid: false, error: `JWT validation failed: ${msg}` };
        }
    }
    /**
     * RFC 7662 token introspection when MASTYF_AI_OIDC_INTROSPECTION=true.
     * Returns true/false when introspection runs; null when skipped or unavailable.
     */
    async introspectTokenActive(token) {
        if (process.env['MASTYF_AI_OIDC_INTROSPECTION'] !== 'true')
            return null;
        try {
            const discovery = await this.discover();
            const endpoint = discovery.introspection_endpoint;
            if (!endpoint) {
                StructuredLogger.info({
                    event: 'oidc_introspection_skipped',
                    reason: 'no_introspection_endpoint',
                    issuer: this.config.issuer,
                });
                return null;
            }
            const clientId = process.env['MASTYF_AI_OIDC_CLIENT_ID']?.trim();
            const clientSecret = process.env['MASTYF_AI_OIDC_CLIENT_SECRET']?.trim();
            const body = new URLSearchParams({ token, token_type_hint: 'access_token' });
            if (clientId)
                body.set('client_id', clientId);
            if (clientSecret)
                body.set('client_secret', clientSecret);
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
            });
            if (!res.ok) {
                StructuredLogger.logError({
                    event: 'oidc_introspection_error',
                    serverName: 'oauth',
                    error: `Introspection HTTP ${res.status}`,
                });
                return process.env['MASTYF_AI_OIDC_INTROSPECTION_FAIL_OPEN'] === 'true' ? null : false;
            }
            const data = (await res.json());
            return data.active === true;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            StructuredLogger.logError({
                event: 'oidc_introspection_error',
                serverName: 'oauth',
                error: message,
            });
            return process.env['MASTYF_AI_OIDC_INTROSPECTION_FAIL_OPEN'] === 'true' ? null : false;
        }
    }
    /**
     * Extract Bearer token from Authorization header.
     */
    static extractToken(authorizationHeader) {
        if (!authorizationHeader)
            return null;
        const trimmed = authorizationHeader.trim();
        const match = trimmed.match(/^Bearer\s+(.+)$/i);
        if (match)
            return match[1];
        if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
            return trimmed;
        }
        return null;
    }
    /**
     * Extract Authorization from MCP JSON-RPC message (stdio and HTTP transports).
     * Supports: root Authorization, params._meta.auth, initialize clientInfo headers, env tokens.
     */
    static extractAuthFromMcpMessage(msg) {
        if (typeof msg.Authorization === 'string')
            return msg.Authorization;
        const params = msg.params;
        const meta = params?._meta;
        const metaAuth = meta?.auth;
        if (typeof metaAuth?.Authorization === 'string')
            return metaAuth.Authorization;
        if (typeof metaAuth?.authorization === 'string')
            return metaAuth.authorization;
        if (typeof metaAuth?.access_token === 'string') {
            return `Bearer ${metaAuth.access_token}`;
        }
        if (typeof params?.Authorization === 'string')
            return params.Authorization;
        if (msg.method === 'initialize' && params) {
            const clientInfo = params.clientInfo;
            const headers = (clientInfo?.headers ?? params.headers);
            if (typeof headers?.Authorization === 'string')
                return headers.Authorization;
            if (typeof headers?.authorization === 'string')
                return headers.authorization;
        }
        const envToken = process.env['MASTYF_AI_BEARER_TOKEN'] ||
            process.env['MASTYF_AI_BEARER_TOKEN'] ||
            process.env['MCP_ACCESS_TOKEN'];
        if (envToken) {
            return envToken.startsWith('Bearer ') ? envToken : `Bearer ${envToken}`;
        }
        return undefined;
    }
    getConfig() {
        return this.config;
    }
}
//# sourceMappingURL=oauth.js.map
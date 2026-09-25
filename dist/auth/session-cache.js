import { randomUUID } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from '../utils/logger.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
function sessionRotationEnabled() {
    return process.env['MASTYF_AI_SESSION_ROTATE_ON_USE'] === 'true';
}
const SESSION_CACHE_MAX = 10_000;
const NONCE_CACHE_MAX = 50_000;
export class SessionCache {
    sessions;
    usedNonces;
    sessionTtlMs;
    nonceTtlMs;
    cleanupInterval = null;
    constructor(sessionTtlMs = 5 * 60 * 1000, nonceTtlMs = 10 * 60 * 1000) {
        this.sessionTtlMs = sessionTtlMs;
        this.nonceTtlMs = nonceTtlMs;
        this.sessions = new LRUCache({
            max: SESSION_CACHE_MAX,
            ttl: sessionTtlMs,
            updateAgeOnGet: false,
        });
        this.usedNonces = new LRUCache({
            max: NONCE_CACHE_MAX,
            ttl: nonceTtlMs,
            updateAgeOnGet: false,
        });
        // Periodic sweep for entries past custom expiresAt (LRU ttl is a backstop)
        this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
        if (typeof this.cleanupInterval.unref === 'function') {
            this.cleanupInterval.unref();
        }
    }
    /** Dispose of the cleanup timer and clear all state */
    dispose() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.sessions.clear();
        this.usedNonces.clear();
    }
    scopedSessionKey(tenantId, token) {
        return `tenant:${tenantId || DEFAULT_TENANT_ID}:session:${token}`;
    }
    scopedNonceKey(tenantId, nonce) {
        return `tenant:${tenantId || DEFAULT_TENANT_ID}:nonce:${nonce}`;
    }
    /**
     * Create a session after successful JWT validation.
     * Returns a session token the client must use for subsequent calls.
     */
    createSession(identity, jwtNonce, tenantId = DEFAULT_TENANT_ID) {
        const nonce = jwtNonce || `${identity.sub}:${Date.now()}:${randomUUID()}`;
        const nonceKey = this.scopedNonceKey(tenantId, nonce);
        if (this.usedNonces.has(nonceKey)) {
            Logger.warn(`[session-cache] Replay detected: nonce ${nonce} (tenant=${tenantId})`);
            throw new Error('Nonce replay detected');
        }
        this.usedNonces.set(nonceKey, Date.now());
        const token = `mastyf_ai_session_${randomUUID()}`;
        const now = Date.now();
        const entry = {
            token,
            identity,
            nonce,
            createdAt: now,
            expiresAt: now + this.sessionTtlMs,
        };
        this.sessions.set(this.scopedSessionKey(tenantId, token), entry);
        return entry;
    }
    /**
     * Validate a session token.
     * Returns the agent identity if valid, null if expired/not found.
     */
    validateSession(token, tenantId = DEFAULT_TENANT_ID) {
        const result = this.validateSessionWithRotation(token, tenantId);
        return result?.identity ?? null;
    }
    /**
     * Validate session and optionally rotate token (L-6).
     * When rotation is enabled, old token is revoked and a new one is issued.
     */
    validateSessionWithRotation(token, tenantId = DEFAULT_TENANT_ID) {
        const key = this.scopedSessionKey(tenantId, token);
        const entry = this.sessions.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.sessions.delete(key);
            return null;
        }
        if (!sessionRotationEnabled()) {
            return { identity: entry.identity };
        }
        this.sessions.delete(key);
        const newToken = `mastyf_ai_session_${randomUUID()}`;
        const now = Date.now();
        const rotated = {
            ...entry,
            token: newToken,
            createdAt: now,
            expiresAt: now + this.sessionTtlMs,
        };
        this.sessions.set(this.scopedSessionKey(tenantId, newToken), rotated);
        void import('../audit/dashboard-access-log.js').then(({ appendSessionRotateAudit }) => appendSessionRotateAudit({ tenantId, oldToken: token, newToken }));
        return { identity: entry.identity, rotatedToken: newToken };
    }
    /** Check if a JWT nonce has been used (replay detection). */
    isNonceUsed(nonce, tenantId = DEFAULT_TENANT_ID) {
        return this.usedNonces.has(this.scopedNonceKey(tenantId, nonce));
    }
    /** Revoke a session (e.g., on logout or suspicious activity). */
    revokeSession(token, tenantId = DEFAULT_TENANT_ID) {
        this.sessions.delete(this.scopedSessionKey(tenantId, token));
    }
    cleanup() {
        const now = Date.now();
        for (const [token, entry] of this.sessions) {
            if (now > entry.expiresAt) {
                this.sessions.delete(token);
            }
        }
    }
    get size() {
        return this.sessions.size;
    }
}
//# sourceMappingURL=session-cache.js.map
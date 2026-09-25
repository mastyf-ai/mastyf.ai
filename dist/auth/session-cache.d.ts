import { AgentIdentity } from './auth-types.js';
/**
 * Session cache for replay protection.
 * After a JWT is validated once, a short-lived session token is issued.
 * Subsequent calls must include this session token, not the raw JWT.
 * This prevents replay of captured JWTs within their expiry window.
 *
 * In production multi-replica, use RedisSessionCache (REDIS_URL).
 */
export interface SessionEntry {
    token: string;
    identity: AgentIdentity;
    nonce: string;
    createdAt: number;
    expiresAt: number;
}
export interface SessionValidationResult {
    identity: AgentIdentity;
    /** Present when MASTYF_AI_SESSION_ROTATE_ON_USE=true and session was validated. */
    rotatedToken?: string;
}
export declare class SessionCache {
    private sessions;
    private usedNonces;
    protected readonly sessionTtlMs: number;
    protected readonly nonceTtlMs: number;
    private cleanupInterval;
    constructor(sessionTtlMs?: number, nonceTtlMs?: number);
    /** Dispose of the cleanup timer and clear all state */
    dispose(): void;
    protected scopedSessionKey(tenantId: string, token: string): string;
    protected scopedNonceKey(tenantId: string, nonce: string): string;
    /**
     * Create a session after successful JWT validation.
     * Returns a session token the client must use for subsequent calls.
     */
    createSession(identity: AgentIdentity, jwtNonce?: string, tenantId?: string): SessionEntry;
    /**
     * Validate a session token.
     * Returns the agent identity if valid, null if expired/not found.
     */
    validateSession(token: string, tenantId?: string): AgentIdentity | null;
    /**
     * Validate session and optionally rotate token (L-6).
     * When rotation is enabled, old token is revoked and a new one is issued.
     */
    validateSessionWithRotation(token: string, tenantId?: string): SessionValidationResult | null;
    /** Check if a JWT nonce has been used (replay detection). */
    isNonceUsed(nonce: string, tenantId?: string): boolean;
    /** Revoke a session (e.g., on logout or suspicious activity). */
    revokeSession(token: string, tenantId?: string): void;
    protected cleanup(): void;
    get size(): number;
}
//# sourceMappingURL=session-cache.d.ts.map
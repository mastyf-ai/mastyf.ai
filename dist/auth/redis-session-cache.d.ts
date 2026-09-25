import { AgentIdentity } from './auth-types.js';
import { SessionCache, SessionEntry } from './session-cache.js';
/**
 * Redis-backed session cache for multi-replica HA deployments.
 * Extends SessionCache to use Redis instead of in-memory Maps.
 * Enable with: REDIS_URL=redis://localhost:6379
 */
export declare class RedisSessionCache extends SessionCache {
    private redis;
    private readonly prefix;
    private readonly noncePrefix;
    private redisSessionKey;
    private redisNonceKey;
    constructor(sessionTtlMs?: number, nonceTtlMs?: number);
    createSession(identity: AgentIdentity, jwtNonce?: string, tenantId?: string): SessionEntry;
    validateSession(token: string, tenantId?: string): AgentIdentity | null;
    validateSessionAsync(token: string, tenantId?: string): Promise<import('./session-cache.js').SessionValidationResult | null>;
    isNonceUsedAsync(nonce: string, tenantId?: string): Promise<boolean>;
    revokeSessionAsync(token: string, tenantId?: string): Promise<void>;
    cleanup(): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=redis-session-cache.d.ts.map
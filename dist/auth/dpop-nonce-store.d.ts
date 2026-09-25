import type { Redis, Cluster } from 'ioredis';
/** Cross-region shared Redis for DPoP jti dedup (falls back to REDIS_URL). */
export declare function resolveDpopRedisUrl(): string | null;
export declare function isDpopRedisConfigured(): boolean;
/** Pluggable DPoP jti replay store (in-memory single instance or Redis HA). */
export interface DPoPNonceStore {
    /** Returns true if this jti is the first use; false if replay. */
    claim(jti: string, tenantId?: string): Promise<boolean>;
    cleanupExpired?(): void;
}
export declare class InMemoryDPoPNonceStore implements DPoPNonceStore {
    private readonly ttlMs;
    private used;
    private lastCleanup;
    constructor(ttlMs: number);
    private scopedKey;
    cleanupExpired(): void;
    claim(jti: string, tenantId?: string): Promise<boolean>;
}
export declare function isDpopLockFreeEnabled(): boolean;
/**
 * Lock-free jti claim: atomic SET NX + jittered retry (§6.2 DPoP contention).
 */
export declare function claimDpopJtiLockFree(redis: Pick<Redis, 'set' | 'get'>, keyPrefix: string, jti: string, ttlSeconds: number, tenantId?: string): Promise<boolean>;
/** Redis claim with short-lived lock — reduces replay window under replication lag. */
export declare function claimDpopJtiOnRedis(redis: Pick<Redis, 'set' | 'get' | 'del'>, keyPrefix: string, jti: string, ttlSeconds: number, tenantId?: string): Promise<boolean>;
export declare class RedisDPoPNonceStore implements DPoPNonceStore {
    private readonly ttlSeconds;
    private redis;
    private readonly prefix;
    private quorumMode;
    constructor(ttlSeconds: number, redis?: Redis | Cluster, connectionString?: string);
    claim(jti: string, tenantId?: string): Promise<boolean>;
    close(): Promise<void>;
}
export declare function createDPoPNonceStore(ttlMs: number): DPoPNonceStore;
//# sourceMappingURL=dpop-nonce-store.d.ts.map
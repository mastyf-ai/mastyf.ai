import { tenantRateLimitKey } from '../tenant/resolve-tenant.js';
export { tenantRateLimitKey };
export declare function getSharedRedisRateLimiter(): RedisRateLimiter;
export declare function resetRedisRateLimiterForTests(): void;
export declare class RedisRateLimiter {
    private redis;
    private prefix;
    private lockPrefix;
    private region;
    private local;
    private globalScope;
    constructor(opts?: {
        redisUrl?: string;
        globalScope?: boolean;
    });
    getRegion(): string;
    /**
     * Optional distributed lock for rate-limit window coordination (active-passive).
     * Returns true if lock acquired or lock not required.
     */
    acquireWindowLock(key: string, windowMs: number): Promise<boolean>;
    /**
     * Check and increment a rate limit counter (atomic INCR across replicas).
     * Pass tenantId to namespace keys as tenant:{tenantId}:...
     */
    checkAndIncrement(key: string, maxRequests: number, windowMs?: number, tenantId?: string, incrementBy?: number): Promise<{
        allowed: boolean;
        count: number;
    }>;
    private checkAndIncrementLocal;
    close(): Promise<void>;
}
export declare function getGlobalRedisRateLimiter(): RedisRateLimiter;
//# sourceMappingURL=redis-rate-limiter.d.ts.map
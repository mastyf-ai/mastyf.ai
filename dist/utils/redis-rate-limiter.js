import { Logger } from './logger.js';
import { getMastyfAiRegion } from './region.js';
import { createRedisClient, getRedisConnectionLabel, isRedisConfigured } from './redis-client.js';
import { DEFAULT_TENANT_ID, tenantRateLimitKey } from '../tenant/resolve-tenant.js';
export { tenantRateLimitKey };
/**
 * Redis-backed rate limit counters for multi-replica HA.
 * Keys include MASTYF_AI_REGION for observability and active-passive isolation.
 * Enable with REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES (see docs/REDIS_HA.md).
 */
let sharedLimiter = null;
let globalLimiter = null;
function isActiveActiveMode() {
    return (process.env['MASTYF_AI_MULTI_REGION_MODE'] || '').toLowerCase() === 'active-active';
}
function globalRateLimitRedisUrl() {
    return process.env['MASTYF_AI_GLOBAL_RATE_LIMIT_REDIS_URL']?.trim() || null;
}
export function getSharedRedisRateLimiter() {
    if (!sharedLimiter) {
        sharedLimiter = new RedisRateLimiter();
    }
    return sharedLimiter;
}
export function resetRedisRateLimiterForTests() {
    if (sharedLimiter) {
        void sharedLimiter.close();
    }
    if (globalLimiter) {
        void globalLimiter.close();
    }
    sharedLimiter = null;
    globalLimiter = null;
}
export class RedisRateLimiter {
    redis;
    prefix;
    lockPrefix;
    region;
    local = new Map();
    globalScope;
    constructor(opts) {
        if (!isRedisConfigured() && !opts?.redisUrl) {
            throw new Error('RedisRateLimiter requires REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES');
        }
        this.region = getMastyfAiRegion();
        this.globalScope = opts?.globalScope === true;
        const scopeLabel = this.globalScope ? 'global' : this.region;
        this.prefix = `mastyf_ai:ratelimit:${scopeLabel}:`;
        this.lockPrefix = `mastyf_ai:ratelimit_lock:${scopeLabel}:`;
        this.redis = opts?.redisUrl
            ? createRedisClient({ connectionString: opts.redisUrl, maxRetriesPerRequest: 2, lazyConnect: false })
            : createRedisClient({ maxRetriesPerRequest: 2, lazyConnect: false });
        Logger.info(`[redis-rate-limiter] Connected (${getRedisConnectionLabel()}, scope=${scopeLabel})`);
    }
    getRegion() {
        return this.region;
    }
    /**
     * Optional distributed lock for rate-limit window coordination (active-passive).
     * Returns true if lock acquired or lock not required.
     */
    async acquireWindowLock(key, windowMs) {
        if (process.env['MASTYF_AI_RATE_LIMIT_DISTRIBUTED_LOCK'] !== 'true')
            return true;
        const lockKey = `${this.lockPrefix}${key}`;
        try {
            const ok = await this.redis.set(lockKey, '1', 'PX', windowMs, 'NX');
            return ok === 'OK';
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.debug(`[redis-rate-limiter] lock acquire failed: ${message}`);
            return true;
        }
    }
    /**
     * Check and increment a rate limit counter (atomic INCR across replicas).
     * Pass tenantId to namespace keys as tenant:{tenantId}:...
     */
    async checkAndIncrement(key, maxRequests, windowMs = 60000, tenantId = DEFAULT_TENANT_ID, incrementBy = 1) {
        const localResult = await this.checkAndIncrementLocal(key, maxRequests, windowMs, tenantId, incrementBy);
        if (isActiveActiveMode()
            && !this.globalScope
            && globalRateLimitRedisUrl()
            && process.env['MASTYF_AI_GLOBAL_RATE_LIMIT_MAX']) {
            const globalMax = parseInt(process.env['MASTYF_AI_GLOBAL_RATE_LIMIT_MAX'] || '0', 10);
            if (globalMax > 0) {
                const globalLimiterInstance = getGlobalRedisRateLimiter();
                const globalResult = await globalLimiterInstance.checkAndIncrementLocal(key, globalMax, windowMs, tenantId);
                if (!globalResult.allowed) {
                    return globalResult;
                }
            }
        }
        return localResult;
    }
    async checkAndIncrementLocal(key, maxRequests, windowMs = 60000, tenantId = DEFAULT_TENANT_ID, incrementBy = 1) {
        const scopedKey = tenantRateLimitKey(tenantId, key);
        const redisKey = `${this.prefix}${scopedKey}`;
        const delta = Math.max(1, Math.floor(incrementBy));
        try {
            const hasLock = await this.acquireWindowLock(scopedKey, windowMs);
            if (!hasLock) {
                return { allowed: false, count: maxRequests + 1 };
            }
            const count = delta === 1
                ? await this.redis.incr(redisKey)
                : await this.redis.incrby(redisKey, delta);
            if (count === 1) {
                await this.redis.pexpire(redisKey, windowMs);
            }
            const now = Date.now();
            let localCounter = this.local.get(scopedKey);
            const windowJitterMs = Math.floor(Math.random() * Math.min(windowMs * 0.1, 500));
            if (!localCounter || now > localCounter.resetAt) {
                localCounter = { count: delta, resetAt: now + windowMs + windowJitterMs };
            }
            else {
                localCounter.count += delta;
            }
            this.local.set(scopedKey, localCounter);
            return { allowed: count <= maxRequests, count };
        }
        catch (err) {
            if (process.env['MASTYF_AI_STRICT_MODE'] === 'true') {
                const message = err instanceof Error ? err.message : String(err);
                Logger.error(`[redis-rate-limiter] Redis unavailable in strict mode: ${message}`);
                return { allowed: false, count: maxRequests + 1 };
            }
            const message = err instanceof Error ? err.message : String(err);
            Logger.debug(`[redis-rate-limiter] Redis error, using local: ${message}`);
            const now = Date.now();
            let localCounter = this.local.get(scopedKey);
            const windowJitterMs = Math.floor(Math.random() * Math.min(windowMs * 0.1, 500));
            if (!localCounter || now > localCounter.resetAt) {
                localCounter = { count: delta, resetAt: now + windowMs + windowJitterMs };
            }
            else {
                localCounter.count += delta;
            }
            this.local.set(scopedKey, localCounter);
            return { allowed: localCounter.count <= maxRequests, count: localCounter.count };
        }
    }
    async close() {
        await this.redis.quit();
    }
}
export function getGlobalRedisRateLimiter() {
    if (!globalLimiter) {
        const url = globalRateLimitRedisUrl();
        if (!url) {
            throw new Error('MASTYF_AI_GLOBAL_RATE_LIMIT_REDIS_URL required for global rate limiter');
        }
        globalLimiter = new RedisRateLimiter({ redisUrl: url, globalScope: true });
    }
    return globalLimiter;
}
//# sourceMappingURL=redis-rate-limiter.js.map
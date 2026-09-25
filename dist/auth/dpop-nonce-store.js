import { Logger } from '../utils/logger.js';
import { createRedisClient, getRedisConnectionLabel, isRedisConfigured } from '../utils/redis-client.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { claimDpopJtiQuorum, getDpopQuorumClients, retryDelayWithJitter } from './dpop-quorum.js';
/** Cross-region shared Redis for DPoP jti dedup (falls back to REDIS_URL). */
export function resolveDpopRedisUrl() {
    const crossRegion = process.env['MASTYF_AI_DPOP_REDIS_URL']?.trim();
    if (crossRegion)
        return crossRegion;
    if (isRedisConfigured()) {
        return process.env['REDIS_URL']?.trim() || null;
    }
    return null;
}
export function isDpopRedisConfigured() {
    return Boolean(resolveDpopRedisUrl() || isRedisConfigured());
}
export class InMemoryDPoPNonceStore {
    ttlMs;
    used = new Map();
    lastCleanup = Date.now();
    constructor(ttlMs) {
        this.ttlMs = ttlMs;
    }
    scopedKey(tenantId, jti) {
        return `tenant:${tenantId || DEFAULT_TENANT_ID}:${jti}`;
    }
    cleanupExpired() {
        const now = Date.now();
        if (now - this.lastCleanup < 60_000)
            return;
        const expiry = now - this.ttlMs;
        for (const [key, ts] of this.used) {
            if (ts < expiry)
                this.used.delete(key);
        }
        this.lastCleanup = now;
    }
    async claim(jti, tenantId = DEFAULT_TENANT_ID) {
        this.cleanupExpired();
        const key = this.scopedKey(tenantId, jti);
        if (this.used.has(key))
            return false;
        this.used.set(key, Date.now());
        return true;
    }
}
const DPOP_LOCK_MAX_ATTEMPTS = 3;
const DPOP_LOCK_BASE_DELAY_MS = 10;
const DPOP_LOCK_FREE_MAX_ATTEMPTS = 5;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function isDpopLockFreeEnabled() {
    if (process.env['MASTYF_AI_DPOP_LOCK_FREE'] === 'false')
        return false;
    if (process.env['MASTYF_AI_DPOP_LOCK_FREE'] === 'true')
        return true;
    return process.env['MASTYF_AI_DPOP_LOCK_FREE'] !== 'legacy';
}
/**
 * Lock-free jti claim: atomic SET NX + jittered retry (§6.2 DPoP contention).
 */
export async function claimDpopJtiLockFree(redis, keyPrefix, jti, ttlSeconds, tenantId = DEFAULT_TENANT_ID) {
    const scopedPrefix = `${keyPrefix}tenant:${tenantId || DEFAULT_TENANT_ID}:`;
    const dataKey = `${scopedPrefix}${jti}`;
    for (let attempt = 0; attempt < DPOP_LOCK_FREE_MAX_ATTEMPTS; attempt++) {
        const ok = await redis.set(dataKey, '1', 'EX', ttlSeconds, 'NX');
        if (ok === 'OK')
            return true;
        const existing = await redis.get(dataKey);
        if (existing)
            return false;
        await sleep(retryDelayWithJitter(attempt, DPOP_LOCK_BASE_DELAY_MS));
    }
    return false;
}
/** Redis claim with short-lived lock — reduces replay window under replication lag. */
export async function claimDpopJtiOnRedis(redis, keyPrefix, jti, ttlSeconds, tenantId = DEFAULT_TENANT_ID) {
    const scopedPrefix = `${keyPrefix}tenant:${tenantId || DEFAULT_TENANT_ID}:`;
    const lockKey = `${scopedPrefix}lock:${jti}`;
    const dataKey = `${scopedPrefix}${jti}`;
    for (let attempt = 0; attempt < DPOP_LOCK_MAX_ATTEMPTS; attempt++) {
        const locked = await redis.set(lockKey, '1', 'EX', 1, 'NX');
        if (locked !== 'OK') {
            await sleep(retryDelayWithJitter(attempt, DPOP_LOCK_BASE_DELAY_MS));
            continue;
        }
        try {
            const existing = await redis.get(dataKey);
            if (existing)
                return false;
            const ok = await redis.set(dataKey, '1', 'EX', ttlSeconds, 'NX');
            return ok === 'OK';
        }
        finally {
            await redis.del(lockKey);
        }
    }
    return false;
}
export class RedisDPoPNonceStore {
    ttlSeconds;
    redis;
    prefix = 'mastyf_ai:dpop:jti:';
    quorumMode = false;
    constructor(ttlSeconds, redis, connectionString) {
        this.ttlSeconds = ttlSeconds;
        this.redis = redis ?? createRedisClient({
            connectionString: connectionString || resolveDpopRedisUrl() || undefined,
            maxRetriesPerRequest: 3,
            lazyConnect: false,
        });
        this.quorumMode = Boolean(process.env['MASTYF_AI_DPOP_QUORUM_REDIS']?.trim());
        const label = connectionString || process.env['MASTYF_AI_DPOP_REDIS_URL']
            ? 'cross-region'
            : getRedisConnectionLabel();
        Logger.info(`[dpop] Redis nonce store (${label}${this.quorumMode ? ', quorum' : ''})`);
    }
    async claim(jti, tenantId = DEFAULT_TENANT_ID) {
        if (this.quorumMode) {
            const clients = await getDpopQuorumClients();
            if (clients.length > 0) {
                return claimDpopJtiQuorum(clients, this.prefix, jti, this.ttlSeconds, tenantId);
            }
        }
        if (isDpopLockFreeEnabled()) {
            return claimDpopJtiLockFree(this.redis, this.prefix, jti, this.ttlSeconds, tenantId);
        }
        return claimDpopJtiOnRedis(this.redis, this.prefix, jti, this.ttlSeconds, tenantId);
    }
    async close() {
        await this.redis.quit();
    }
}
export function createDPoPNonceStore(ttlMs) {
    const dpopUrl = resolveDpopRedisUrl();
    if (dpopUrl || isRedisConfigured()) {
        return new RedisDPoPNonceStore(Math.ceil(ttlMs / 1000), undefined, dpopUrl || undefined);
    }
    if (process.env['MASTYF_AI_CLUSTER_MODE'] === 'true' || process.env['KUBERNETES_SERVICE_HOST']) {
        Logger.warn('[dpop] Using in-memory DPoP nonce store in clustered deployment — set REDIS_URL or MASTYF_AI_DPOP_REDIS_URL for replay protection across instances');
    }
    return new InMemoryDPoPNonceStore(ttlMs);
}
//# sourceMappingURL=dpop-nonce-store.js.map
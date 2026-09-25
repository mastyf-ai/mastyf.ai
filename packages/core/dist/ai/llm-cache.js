import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Redis } from 'ioredis';
let sharedCache = null;
export function isLlmCacheEnabled() {
    if (process.env.MASTYF_AI_LLM_CACHE === 'false')
        return false;
    if (process.env.MASTYF_AI_LLM_CACHE === 'true')
        return true;
    return Boolean(process.env.REDIS_URL);
}
export function getLlmCache() {
    if (!sharedCache) {
        sharedCache = new LlmCache();
    }
    return sharedCache;
}
export function resetLlmCacheForTests() {
    if (sharedCache) {
        void sharedCache.close();
    }
    sharedCache = null;
}
/** Clear in-memory and Redis LLM verdict cache after policy reload (M-007). */
export async function invalidateLlmCache() {
    if (sharedCache) {
        await sharedCache.clear();
    }
}
function hashCacheKey(input) {
    const mode = input.policyMode?.trim() || 'block';
    const policyVersion = input.policyVersion?.trim() || 'default';
    const onlyOnHits = input.onlyOnHits ? '1' : '0';
    const alwaysRun = input.alwaysRun ? '1' : '0';
    const payload = `${mode}\0${policyVersion}\0${onlyOnHits}\0${alwaysRun}\0${input.model}\0${input.system}\0${input.prompt}\0${input.temperature}`;
    return createHash('sha256').update(payload).digest('hex');
}
/** @internal Exposed for cache-key regression tests. */
export function hashLlmCacheKeyForTests(input) {
    return hashCacheKey(input);
}
function ttlSec() {
    const parsed = parseInt(process.env.MASTYF_AI_LLM_CACHE_TTL_SEC || '3600', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
}
function getRegion() {
    return process.env.MASTYF_AI_REGION || process.env.AWS_REGION || 'default';
}
const LRU_MAX = 500;
export class LlmCache {
    enabled;
    ttlMs;
    redisPrefix;
    redis = null;
    lru;
    hits = 0;
    misses = 0;
    constructor() {
        this.enabled = isLlmCacheEnabled();
        this.ttlMs = ttlSec() * 1000;
        this.redisPrefix = `mastyf_ai:llm_cache:${getRegion()}:`;
        this.lru = new LRUCache({ max: LRU_MAX, ttl: this.ttlMs });
        const redisUrl = process.env.REDIS_URL;
        if (this.enabled && redisUrl) {
            this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
        }
    }
    storageKey(input) {
        return hashCacheKey(input);
    }
    redisKey(hash) {
        return `${this.redisPrefix}${hash}`;
    }
    async get(input) {
        if (!this.enabled)
            return null;
        const hash = this.storageKey(input);
        if (this.redis) {
            try {
                const value = await this.redis.get(this.redisKey(hash));
                if (value != null) {
                    this.lru.set(hash, value);
                    this.hits++;
                    return value;
                }
            }
            catch {
                /* fall through to LRU */
            }
        }
        const local = this.lru.get(hash);
        if (local != null) {
            this.hits++;
            return local;
        }
        this.misses++;
        return null;
    }
    async set(input, value) {
        if (!this.enabled)
            return;
        const hash = this.storageKey(input);
        this.lru.set(hash, value);
        if (!this.redis)
            return;
        try {
            await this.redis.set(this.redisKey(hash), value, 'EX', ttlSec());
        }
        catch {
            /* LRU still holds the entry */
        }
    }
    async close() {
        await this.clear();
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
        }
    }
    async clear() {
        this.lru.clear();
        this.hits = 0;
        this.misses = 0;
        if (!this.redis)
            return;
        try {
            const pattern = `${this.redisPrefix}*`;
            let cursor = '0';
            do {
                const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = next;
                if (keys.length)
                    await this.redis.del(...keys);
            } while (cursor !== '0');
        }
        catch {
            /* LRU already cleared */
        }
    }
}
//# sourceMappingURL=llm-cache.js.map
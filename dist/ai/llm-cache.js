import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { createRedisClient, getRedisConnectionLabel, isRedisConfigured } from '../utils/redis-client.js';
import { Counter } from 'prom-client';
import { Logger } from '../utils/logger.js';
import { registry } from '../utils/metrics.js';
import { getMastyfAiRegion } from '../utils/region.js';
const cacheHits = new Counter({
    name: 'mastyf_ai_llm_cache_hits_total',
    help: 'LLM response cache hits',
    labelNames: ['backend'],
    registers: [registry],
});
const cacheMisses = new Counter({
    name: 'mastyf_ai_llm_cache_misses_total',
    help: 'LLM response cache misses',
    labelNames: ['backend'],
    registers: [registry],
});
let sharedCache = null;
export function isLlmCacheEnabled() {
    if (process.env.MASTYF_AI_LLM_CACHE === 'false')
        return false;
    if (process.env.MASTYF_AI_LLM_CACHE === 'true')
        return true;
    return isRedisConfigured();
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
function hashCacheKey(input) {
    const payload = `${input.model}\0${input.system}\0${input.prompt}\0${input.temperature}`;
    return createHash('sha256').update(payload).digest('hex');
}
function normalizeArgLeaves(args) {
    if (!args || typeof args !== 'object')
        return '';
    const parts = [];
    const walk = (v) => {
        if (typeof v === 'string')
            parts.push(v);
        else if (Array.isArray(v))
            v.forEach(walk);
        else if (v && typeof v === 'object')
            Object.values(v).forEach(walk);
    };
    walk(args);
    return parts.join('\n').toLowerCase().replace(/\s+/g, ' ').trim();
}
export function hashSemanticAuditKey(input) {
    const argNorm = normalizeArgLeaves(input.arguments);
    const tenant = input.tenantId?.trim() || 'default';
    const mode = input.policyMode?.trim() || 'block';
    const payload = `${tenant}\0${mode}\0${input.model}\0${input.serverName}\0${input.toolName}\0${argNorm}\0${input.temperature}`;
    return createHash('sha256').update(payload).digest('hex');
}
export function semanticToLlmCacheKey(input, system, userPrompt) {
    const fp = hashSemanticAuditKey(input);
    return {
        model: input.model,
        system,
        prompt: `semantic-fp:${fp}\n${userPrompt}`,
        temperature: input.temperature,
    };
}
function ttlSec() {
    const parsed = parseInt(process.env.MASTYF_AI_LLM_CACHE_TTL_SEC || '86400', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 86400;
}
const LRU_MAX = 500;
export class LlmCache {
    enabled;
    ttlMs;
    region;
    redisPrefix;
    redis = null;
    lru;
    constructor() {
        this.enabled = isLlmCacheEnabled();
        this.ttlMs = ttlSec() * 1000;
        this.region = getMastyfAiRegion();
        this.redisPrefix = `mastyf_ai:llm_cache:${this.region}:`;
        this.lru = new LRUCache({
            max: LRU_MAX,
            ttl: this.ttlMs,
            updateAgeOnGet: false,
        });
        if (this.enabled && isRedisConfigured()) {
            this.redis = createRedisClient({ maxRetriesPerRequest: 2, lazyConnect: false });
            Logger.info(`[llm-cache] Redis backend ${getRedisConnectionLabel()} (region=${this.region}, ttl=${ttlSec()}s)`);
        }
        else if (this.enabled) {
            Logger.info('[llm-cache] In-memory LRU backend (Redis not configured)');
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
                    cacheHits.inc({ backend: 'redis' });
                    return value;
                }
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                Logger.debug(`[llm-cache] Redis get failed: ${msg}`);
            }
        }
        const local = this.lru.get(hash);
        if (local != null) {
            cacheHits.inc({ backend: 'lru' });
            return local;
        }
        cacheMisses.inc({ backend: this.redis ? 'redis' : 'lru' });
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
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            Logger.debug(`[llm-cache] Redis set failed: ${msg}`);
        }
    }
    async close() {
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
        }
        this.lru.clear();
    }
}
//# sourceMappingURL=llm-cache.js.map
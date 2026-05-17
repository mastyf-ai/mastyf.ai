import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import type { Redis, Cluster } from 'ioredis';
import { createRedisClient, getRedisConnectionLabel, isRedisConfigured } from '../utils/redis-client.js';
import { Counter } from 'prom-client';
import { Logger } from '../utils/logger.js';
import { registry } from '../utils/metrics.js';
import { getGuardianRegion } from '../utils/region.js';

export interface LlmCacheKeyInput {
  model: string;
  prompt: string;
  system: string;
  temperature: number;
}

const cacheHits = new Counter({
  name: 'mcp_guardian_llm_cache_hits_total',
  help: 'LLM response cache hits',
  labelNames: ['backend'],
  registers: [registry],
});

const cacheMisses = new Counter({
  name: 'mcp_guardian_llm_cache_misses_total',
  help: 'LLM response cache misses',
  labelNames: ['backend'],
  registers: [registry],
});

let sharedCache: LlmCache | null = null;

export function isLlmCacheEnabled(): boolean {
  if (process.env.GUARDIAN_LLM_CACHE === 'false') return false;
  if (process.env.GUARDIAN_LLM_CACHE === 'true') return true;
  return isRedisConfigured();
}

export function getLlmCache(): LlmCache {
  if (!sharedCache) {
    sharedCache = new LlmCache();
  }
  return sharedCache;
}

export function resetLlmCacheForTests(): void {
  if (sharedCache) {
    void sharedCache.close();
  }
  sharedCache = null;
}

function hashCacheKey(input: LlmCacheKeyInput): string {
  const payload = `${input.model}\0${input.system}\0${input.prompt}\0${input.temperature}`;
  return createHash('sha256').update(payload).digest('hex');
}

function ttlSec(): number {
  const parsed = parseInt(process.env.GUARDIAN_LLM_CACHE_TTL_SEC || '3600', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
}

const LRU_MAX = 500;

export class LlmCache {
  private readonly enabled: boolean;
  private readonly ttlMs: number;
  private readonly region: string;
  private readonly redisPrefix: string;
  private redis: Redis | Cluster | null = null;
  private readonly lru: LRUCache<string, string>;

  constructor() {
    this.enabled = isLlmCacheEnabled();
    this.ttlMs = ttlSec() * 1000;
    this.region = getGuardianRegion();
    this.redisPrefix = `mcp_guardian:llm_cache:${this.region}:`;
    this.lru = new LRUCache<string, string>({ max: LRU_MAX, ttl: this.ttlMs });

    if (this.enabled && isRedisConfigured()) {
      this.redis = createRedisClient({ maxRetriesPerRequest: 2, lazyConnect: false });
      Logger.info(`[llm-cache] Redis backend ${getRedisConnectionLabel()} (region=${this.region}, ttl=${ttlSec()}s)`);
    } else if (this.enabled) {
      Logger.info('[llm-cache] In-memory LRU backend (Redis not configured)');
    }
  }

  private storageKey(input: LlmCacheKeyInput): string {
    return hashCacheKey(input);
  }

  private redisKey(hash: string): string {
    return `${this.redisPrefix}${hash}`;
  }

  async get(input: LlmCacheKeyInput): Promise<string | null> {
    if (!this.enabled) return null;

    const hash = this.storageKey(input);

    if (this.redis) {
      try {
        const value = await this.redis.get(this.redisKey(hash));
        if (value != null) {
          this.lru.set(hash, value);
          cacheHits.inc({ backend: 'redis' });
          return value;
        }
      } catch (err: unknown) {
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

  async set(input: LlmCacheKeyInput, value: string): Promise<void> {
    if (!this.enabled) return;

    const hash = this.storageKey(input);
    this.lru.set(hash, value);

    if (!this.redis) return;

    try {
      await this.redis.set(this.redisKey(hash), value, 'EX', ttlSec());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.debug(`[llm-cache] Redis set failed: ${msg}`);
    }
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
    this.lru.clear();
  }
}

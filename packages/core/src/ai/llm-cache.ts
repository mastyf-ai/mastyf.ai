import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Redis } from 'ioredis';

export interface LlmCacheKeyInput {
  model: string;
  prompt: string;
  system: string;
  temperature: number;
  policyMode?: string;
  /** Engine scan mode — must differ so onlyOnHits vs thorough scans do not share verdicts. */
  onlyOnHits?: boolean;
  alwaysRun?: boolean;
}

let sharedCache: LlmCache | null = null;

export function isLlmCacheEnabled(): boolean {
  if (process.env.MASTYF_AI_LLM_CACHE === 'false') return false;
  if (process.env.MASTYF_AI_LLM_CACHE === 'true') return true;
  return Boolean(process.env.REDIS_URL);
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
  const mode = input.policyMode?.trim() || 'block';
  const onlyOnHits = input.onlyOnHits ? '1' : '0';
  const alwaysRun = input.alwaysRun ? '1' : '0';
  const payload = `${mode}\0${onlyOnHits}\0${alwaysRun}\0${input.model}\0${input.system}\0${input.prompt}\0${input.temperature}`;
  return createHash('sha256').update(payload).digest('hex');
}

/** @internal Exposed for cache-key regression tests. */
export function hashLlmCacheKeyForTests(input: LlmCacheKeyInput): string {
  return hashCacheKey(input);
}

function ttlSec(): number {
  const parsed = parseInt(process.env.MASTYF_AI_LLM_CACHE_TTL_SEC || '3600', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
}

function getRegion(): string {
  return process.env.MASTYF_AI_REGION || process.env.AWS_REGION || 'default';
}

const LRU_MAX = 500;

export class LlmCache {
  private readonly enabled: boolean;
  private readonly ttlMs: number;
  private readonly redisPrefix: string;
  private redis: Redis | null = null;
  private readonly lru: LRUCache<string, string>;
  hits = 0;
  misses = 0;

  constructor() {
    this.enabled = isLlmCacheEnabled();
    this.ttlMs = ttlSec() * 1000;
    this.redisPrefix = `mastyf_ai:llm_cache:${getRegion()}:`;
    this.lru = new LRUCache<string, string>({ max: LRU_MAX, ttl: this.ttlMs });

    const redisUrl = process.env.REDIS_URL;
    if (this.enabled && redisUrl) {
      this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
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
          this.hits++;
          return value;
        }
      } catch {
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

  async set(input: LlmCacheKeyInput, value: string): Promise<void> {
    if (!this.enabled) return;

    const hash = this.storageKey(input);
    this.lru.set(hash, value);

    if (!this.redis) return;

    try {
      await this.redis.set(this.redisKey(hash), value, 'EX', ttlSec());
    } catch {
      /* LRU still holds the entry */
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

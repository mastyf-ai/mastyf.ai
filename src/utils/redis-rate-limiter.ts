import type { Redis, Cluster } from 'ioredis';
import { Logger } from './logger.js';
import { getGuardianRegion } from './region.js';
import { createRedisClient, getRedisConnectionLabel, isRedisConfigured } from './redis-client.js';
import { DEFAULT_TENANT_ID, tenantRateLimitKey } from '../tenant/resolve-tenant.js';

export { tenantRateLimitKey };

/**
 * Redis-backed rate limit counters for multi-replica HA.
 * Keys include GUARDIAN_REGION for observability and active-passive isolation.
 * Enable with REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES (see docs/REDIS_HA.md).
 */
let sharedLimiter: RedisRateLimiter | null = null;

export function getSharedRedisRateLimiter(): RedisRateLimiter {
  if (!sharedLimiter) {
    sharedLimiter = new RedisRateLimiter();
  }
  return sharedLimiter;
}

export function resetRedisRateLimiterForTests(): void {
  if (sharedLimiter) {
    void sharedLimiter.close();
  }
  sharedLimiter = null;
}

export class RedisRateLimiter {
  private redis: Redis | Cluster;
  private prefix: string;
  private lockPrefix: string;
  private region: string;
  private local: Map<string, { count: number; resetAt: number }> = new Map();

  constructor() {
    if (!isRedisConfigured()) {
      throw new Error('RedisRateLimiter requires REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES');
    }
    this.region = getGuardianRegion();
    this.prefix = `mcp_guardian:ratelimit:${this.region}:`;
    this.lockPrefix = `mcp_guardian:ratelimit_lock:${this.region}:`;
    this.redis = createRedisClient({ maxRetriesPerRequest: 2, lazyConnect: false });
    Logger.info(`[redis-rate-limiter] Connected (${getRedisConnectionLabel()}, region=${this.region})`);
  }

  getRegion(): string {
    return this.region;
  }

  /**
   * Optional distributed lock for rate-limit window coordination (active-passive).
   * Returns true if lock acquired or lock not required.
   */
  async acquireWindowLock(key: string, windowMs: number): Promise<boolean> {
    if (process.env['GUARDIAN_RATE_LIMIT_DISTRIBUTED_LOCK'] !== 'true') return true;
    const lockKey = `${this.lockPrefix}${key}`;
    try {
      const ok = await this.redis.set(lockKey, '1', 'PX', windowMs, 'NX');
      return ok === 'OK';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.debug(`[redis-rate-limiter] lock acquire failed: ${message}`);
      return true;
    }
  }

  /**
   * Check and increment a rate limit counter (atomic INCR across replicas).
   * Pass tenantId to namespace keys as tenant:{tenantId}:...
   */
  async checkAndIncrement(
    key: string,
    maxRequests: number,
    windowMs: number = 60000,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<{ allowed: boolean; count: number }> {
    const scopedKey = tenantRateLimitKey(tenantId, key);
    const redisKey = `${this.prefix}${scopedKey}`;

    try {
      const hasLock = await this.acquireWindowLock(scopedKey, windowMs);
      if (!hasLock) {
        return { allowed: false, count: maxRequests + 1 };
      }

      const count = await this.redis.incr(redisKey);
      if (count === 1) {
        await this.redis.pexpire(redisKey, windowMs);
      }

      const now = Date.now();
      let localCounter = this.local.get(scopedKey);
      const windowJitterMs = Math.floor(Math.random() * Math.min(windowMs * 0.1, 500));
      if (!localCounter || now > localCounter.resetAt) {
        localCounter = { count: 1, resetAt: now + windowMs + windowJitterMs };
      } else {
        localCounter.count++;
      }
      this.local.set(scopedKey, localCounter);

      return { allowed: count <= maxRequests, count };
    } catch (err: unknown) {
      if (process.env['GUARDIAN_STRICT_MODE'] === 'true') {
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
        localCounter = { count: 1, resetAt: now + windowMs + windowJitterMs };
      } else {
        localCounter.count++;
      }
      this.local.set(scopedKey, localCounter);
      return { allowed: localCounter.count <= maxRequests, count: localCounter.count };
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

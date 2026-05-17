import type { Redis, Cluster } from 'ioredis';
import { createRedisClient, getRedisConnectionLabel } from '../utils/redis-client.js';
import { AgentIdentity } from './auth-types.js';
import { SessionCache, SessionEntry } from './session-cache.js';
import { Logger } from '../utils/logger.js';

/**
 * Redis-backed session cache for multi-replica HA deployments.
 * Extends SessionCache to use Redis instead of in-memory Maps.
 * Enable with: REDIS_URL=redis://localhost:6379
 */
export class RedisSessionCache extends SessionCache {
  private redis: Redis | Cluster;
  private readonly prefix = 'mcp_guardian:session:';
  private readonly noncePrefix = 'mcp_guardian:nonce:';

  constructor(sessionTtlMs: number = 5 * 60 * 1000, nonceTtlMs: number = 10 * 60 * 1000) {
    super(sessionTtlMs, nonceTtlMs);
    this.redis = createRedisClient({ maxRetriesPerRequest: 3, lazyConnect: false });
    Logger.info(`[redis-session-cache] Connected (${getRedisConnectionLabel()})`);
  }

  override createSession(identity: AgentIdentity, jwtNonce?: string): SessionEntry {
    const entry = super.createSession(identity, jwtNonce);

    // Store in Redis with TTL
    const ttlSeconds = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    this.redis.setex(
      `${this.prefix}${entry.token}`,
      ttlSeconds,
      JSON.stringify(entry)
    ).catch(err => Logger.error(`[redis-session-cache] Failed to store session: ${err?.message}`));

    // Store nonce with longer TTL
    if (entry.nonce) {
      const nonceTtlSeconds = Math.ceil(this.sessionTtlMs / 1000) * 2;
      this.redis.setex(`${this.noncePrefix}${entry.nonce}`, nonceTtlSeconds, '1')
        .catch(err => Logger.error(`[redis-session-cache] Failed to store nonce: ${err?.message}`));
    }

    return entry;
  }

  override validateSession(token: string): AgentIdentity | null {
    // Check local cache first, then Redis
    const local = super.validateSession(token);
    if (local) return local;

    // Fallback to Redis for cross-replica sessions
    // Note: async validateSession would require refactoring proxy-server
    return null;
  }

  async validateSessionAsync(token: string): Promise<AgentIdentity | null> {
    const raw = await this.redis.get(`${this.prefix}${token}`);
    if (!raw) return null;
    try {
      const entry: SessionEntry = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) {
        this.redis.del(`${this.prefix}${token}`);
        return null;
      }
      return entry.identity;
    } catch {
      return null;
    }
  }

  async isNonceUsedAsync(nonce: string): Promise<boolean> {
    const exists = await this.redis.exists(`${this.noncePrefix}${nonce}`);
    return exists === 1;
  }

  async revokeSessionAsync(token: string): Promise<void> {
    await this.redis.del(`${this.prefix}${token}`);
  }

  async cleanup(): Promise<void> {
    // Redis handles expiry via TTL — no manual cleanup needed
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
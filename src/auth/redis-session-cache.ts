import type { Redis, Cluster } from 'ioredis';
import { randomUUID } from 'crypto';
import { createRedisClient, getRedisConnectionLabel } from '../utils/redis-client.js';
import { AgentIdentity } from './auth-types.js';
import { SessionCache, SessionEntry } from './session-cache.js';
import { Logger } from '../utils/logger.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';

/**
 * Redis-backed session cache for multi-replica HA deployments.
 * Extends SessionCache to use Redis instead of in-memory Maps.
 * Enable with: REDIS_URL=redis://localhost:6379
 */
export class RedisSessionCache extends SessionCache {
  private redis: Redis | Cluster;
  private readonly prefix = 'mcp_guardian:session:';
  private readonly noncePrefix = 'mcp_guardian:nonce:';

  private redisSessionKey(tenantId: string, token: string): string {
    return `${this.prefix}tenant:${tenantId || DEFAULT_TENANT_ID}:${token}`;
  }

  private redisNonceKey(tenantId: string, nonce: string): string {
    return `${this.noncePrefix}tenant:${tenantId || DEFAULT_TENANT_ID}:${nonce}`;
  }

  constructor(sessionTtlMs: number = 5 * 60 * 1000, nonceTtlMs: number = 10 * 60 * 1000) {
    super(sessionTtlMs, nonceTtlMs);
    this.redis = createRedisClient({ maxRetriesPerRequest: 3, lazyConnect: false });
    Logger.info(`[redis-session-cache] Connected (${getRedisConnectionLabel()})`);
  }

  override createSession(
    identity: AgentIdentity,
    jwtNonce?: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): SessionEntry {
    const entry = super.createSession(identity, jwtNonce, tenantId);

    const ttlSeconds = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    this.redis.setex(
      this.redisSessionKey(tenantId, entry.token),
      ttlSeconds,
      JSON.stringify(entry),
    ).catch(err => Logger.error(`[redis-session-cache] Failed to store session: ${err?.message}`));

    if (entry.nonce) {
      const nonceTtlSeconds = Math.ceil(this.sessionTtlMs / 1000) * 2;
      this.redis.setex(this.redisNonceKey(tenantId, entry.nonce), nonceTtlSeconds, '1')
        .catch(err => Logger.error(`[redis-session-cache] Failed to store nonce: ${err?.message}`));
    }

    return entry;
  }

  override validateSession(token: string, tenantId: string = DEFAULT_TENANT_ID): AgentIdentity | null {
    const local = super.validateSession(token, tenantId);
    if (local) return local;
    return null;
  }

  async validateSessionAsync(
    token: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<import('./session-cache.js').SessionValidationResult | null> {
    const raw = await this.redis.get(this.redisSessionKey(tenantId, token));
    if (!raw) return null;
    try {
      const entry: SessionEntry = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) {
        await this.redis.del(this.redisSessionKey(tenantId, token));
        return null;
      }

      if (process.env['GUARDIAN_SESSION_ROTATE_ON_USE'] !== 'true') {
        return { identity: entry.identity };
      }

      const newToken = `mcp_guardian_session_${randomUUID()}`;
      const now = Date.now();
      const newEntry: SessionEntry = {
        ...entry,
        token: newToken,
        createdAt: now,
        expiresAt: now + this.sessionTtlMs,
      };
      const ttlSeconds = Math.ceil(this.sessionTtlMs / 1000);
      await this.redis.setex(
        this.redisSessionKey(tenantId, newToken),
        ttlSeconds,
        JSON.stringify(newEntry),
      );
      await this.redis.del(this.redisSessionKey(tenantId, token));
      return { identity: entry.identity, rotatedToken: newToken };
    } catch {
      return null;
    }
  }

  async isNonceUsedAsync(nonce: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    const exists = await this.redis.exists(this.redisNonceKey(tenantId, nonce));
    return exists === 1;
  }

  async revokeSessionAsync(token: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    await this.redis.del(this.redisSessionKey(tenantId, token));
  }

  async cleanup(): Promise<void> {
    // Redis handles expiry via TTL — no manual cleanup needed
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
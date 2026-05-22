import type { Redis, Cluster } from 'ioredis';
import { Logger } from '../utils/logger.js';
import { createRedisClient, getRedisConnectionLabel, isRedisConfigured } from '../utils/redis-client.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { claimDpopJtiQuorum, getDpopQuorumClients, retryDelayWithJitter } from './dpop-quorum.js';

/** Pluggable DPoP jti replay store (in-memory single instance or Redis HA). */
export interface DPoPNonceStore {
  /** Returns true if this jti is the first use; false if replay. */
  claim(jti: string, tenantId?: string): Promise<boolean>;
  cleanupExpired?(): void;
}

export class InMemoryDPoPNonceStore implements DPoPNonceStore {
  private used = new Map<string, number>();
  private lastCleanup = Date.now();

  constructor(private readonly ttlMs: number) {}

  private scopedKey(tenantId: string, jti: string): string {
    return `tenant:${tenantId || DEFAULT_TENANT_ID}:${jti}`;
  }

  cleanupExpired(): void {
    const now = Date.now();
    if (now - this.lastCleanup < 60_000) return;
    const expiry = now - this.ttlMs;
    for (const [key, ts] of this.used) {
      if (ts < expiry) this.used.delete(key);
    }
    this.lastCleanup = now;
  }

  async claim(jti: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    this.cleanupExpired();
    const key = this.scopedKey(tenantId, jti);
    if (this.used.has(key)) return false;
    this.used.set(key, Date.now());
    return true;
  }
}

const DPOP_LOCK_MAX_ATTEMPTS = 3;
const DPOP_LOCK_BASE_DELAY_MS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Redis claim with short-lived lock — reduces replay window under replication lag. */
export async function claimDpopJtiOnRedis(
  redis: Pick<Redis, 'set' | 'get' | 'del'>,
  keyPrefix: string,
  jti: string,
  ttlSeconds: number,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<boolean> {
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
      if (existing) return false;
      const ok = await redis.set(dataKey, '1', 'EX', ttlSeconds, 'NX');
      return ok === 'OK';
    } finally {
      await redis.del(lockKey);
    }
  }
  return false;
}

export class RedisDPoPNonceStore implements DPoPNonceStore {
  private redis: Redis | Cluster;
  private readonly prefix = 'mcp_guardian:dpop:jti:';
  private quorumMode = false;

  constructor(
    private readonly ttlSeconds: number,
    redis?: Redis | Cluster,
  ) {
    this.redis = redis ?? createRedisClient({ maxRetriesPerRequest: 3, lazyConnect: false });
    this.quorumMode = Boolean(process.env['GUARDIAN_DPOP_QUORUM_REDIS']?.trim());
    Logger.info(
      `[dpop] Redis nonce store (${getRedisConnectionLabel()}${this.quorumMode ? ', quorum' : ''})`,
    );
  }

  async claim(jti: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    if (this.quorumMode) {
      const clients = await getDpopQuorumClients();
      if (clients.length > 0) {
        return claimDpopJtiQuorum(clients, this.prefix, jti, this.ttlSeconds, tenantId);
      }
    }
    return claimDpopJtiOnRedis(this.redis, this.prefix, jti, this.ttlSeconds, tenantId);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

export function createDPoPNonceStore(ttlMs: number): DPoPNonceStore {
  if (isRedisConfigured()) {
    return new RedisDPoPNonceStore(Math.ceil(ttlMs / 1000));
  }
  if (process.env['GUARDIAN_CLUSTER_MODE'] === 'true' || process.env['KUBERNETES_SERVICE_HOST']) {
    Logger.warn(
      '[dpop] Using in-memory DPoP nonce store in clustered deployment — set Redis for replay protection across instances',
    );
  }
  return new InMemoryDPoPNonceStore(ttlMs);
}

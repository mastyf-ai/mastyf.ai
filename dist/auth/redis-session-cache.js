import { randomUUID } from 'crypto';
import { createRedisClient, getRedisConnectionLabel } from '../utils/redis-client.js';
import { SessionCache } from './session-cache.js';
import { Logger } from '../utils/logger.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
/**
 * Redis-backed session cache for multi-replica HA deployments.
 * Extends SessionCache to use Redis instead of in-memory Maps.
 * Enable with: REDIS_URL=redis://localhost:6379
 */
export class RedisSessionCache extends SessionCache {
    redis;
    prefix = 'mastyf_ai:session:';
    noncePrefix = 'mastyf_ai:nonce:';
    redisSessionKey(tenantId, token) {
        return `${this.prefix}tenant:${tenantId || DEFAULT_TENANT_ID}:${token}`;
    }
    redisNonceKey(tenantId, nonce) {
        return `${this.noncePrefix}tenant:${tenantId || DEFAULT_TENANT_ID}:${nonce}`;
    }
    constructor(sessionTtlMs = 5 * 60 * 1000, nonceTtlMs = 10 * 60 * 1000) {
        super(sessionTtlMs, nonceTtlMs);
        this.redis = createRedisClient({ maxRetriesPerRequest: 3, lazyConnect: false });
        Logger.info(`[redis-session-cache] Connected (${getRedisConnectionLabel()})`);
    }
    createSession(identity, jwtNonce, tenantId = DEFAULT_TENANT_ID) {
        const entry = super.createSession(identity, jwtNonce, tenantId);
        const ttlSeconds = Math.ceil((entry.expiresAt - Date.now()) / 1000);
        this.redis.setex(this.redisSessionKey(tenantId, entry.token), ttlSeconds, JSON.stringify(entry)).catch(err => Logger.error(`[redis-session-cache] Failed to store session: ${err?.message}`));
        if (entry.nonce) {
            const nonceTtlSeconds = Math.ceil(this.sessionTtlMs / 1000) * 2;
            this.redis.setex(this.redisNonceKey(tenantId, entry.nonce), nonceTtlSeconds, '1')
                .catch(err => Logger.error(`[redis-session-cache] Failed to store nonce: ${err?.message}`));
        }
        return entry;
    }
    validateSession(token, tenantId = DEFAULT_TENANT_ID) {
        const local = super.validateSession(token, tenantId);
        if (local)
            return local;
        return null;
    }
    async validateSessionAsync(token, tenantId = DEFAULT_TENANT_ID) {
        const raw = await this.redis.get(this.redisSessionKey(tenantId, token));
        if (!raw)
            return null;
        try {
            const entry = JSON.parse(raw);
            if (Date.now() > entry.expiresAt) {
                await this.redis.del(this.redisSessionKey(tenantId, token));
                return null;
            }
            if (process.env['MASTYF_AI_SESSION_ROTATE_ON_USE'] !== 'true') {
                return { identity: entry.identity };
            }
            const newToken = `mastyf_ai_session_${randomUUID()}`;
            const now = Date.now();
            const newEntry = {
                ...entry,
                token: newToken,
                createdAt: now,
                expiresAt: now + this.sessionTtlMs,
            };
            const ttlSeconds = Math.ceil(this.sessionTtlMs / 1000);
            await this.redis.setex(this.redisSessionKey(tenantId, newToken), ttlSeconds, JSON.stringify(newEntry));
            await this.redis.del(this.redisSessionKey(tenantId, token));
            return { identity: entry.identity, rotatedToken: newToken };
        }
        catch {
            return null;
        }
    }
    async isNonceUsedAsync(nonce, tenantId = DEFAULT_TENANT_ID) {
        const exists = await this.redis.exists(this.redisNonceKey(tenantId, nonce));
        return exists === 1;
    }
    async revokeSessionAsync(token, tenantId = DEFAULT_TENANT_ID) {
        await this.redis.del(this.redisSessionKey(tenantId, token));
    }
    async cleanup() {
        // Redis handles expiry via TTL — no manual cleanup needed
    }
    async close() {
        await this.redis.quit();
    }
}
//# sourceMappingURL=redis-session-cache.js.map
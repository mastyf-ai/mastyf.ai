/**
 * tools/call idempotency — reject duplicate allowed requests within TTL (block mode).
 */
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { isRedisConfigured, getSharedRedisClient } from '../utils/redis-client.js';
import { tenantRateLimitKey } from '../tenant/resolve-tenant.js';
const memoryCache = new LRUCache({ max: 10000 });
function idempotencyTtlMs() {
    const n = parseInt(process.env['MASTYF_AI_IDEMPOTENCY_TTL_MS'] || '300000', 10);
    return Number.isFinite(n) && n > 0 ? n : 300000;
}
export function idempotencyKeyFromRequest(meta, headerKey) {
    const fromHeader = headerKey?.trim();
    if (fromHeader)
        return fromHeader;
    const fromMeta = meta?.idempotencyKey;
    if (typeof fromMeta === 'string' && fromMeta.trim())
        return fromMeta.trim();
    return undefined;
}
export function hashIdempotentPayload(tenantId, serverName, toolName, args, key) {
    const body = JSON.stringify({ tenantId, serverName, toolName, args, key });
    return createHash('sha256').update(body).digest('hex');
}
/**
 * Returns true if this idempotency key was already seen (duplicate).
 */
export async function isDuplicateIdempotentRequest(cacheKey, tenantId) {
    const ttlMs = idempotencyTtlMs();
    const redisKey = tenantRateLimitKey(tenantId, `idempotency:${cacheKey}`);
    if (isRedisConfigured()) {
        try {
            const redis = getSharedRedisClient();
            const set = await redis.set(redisKey, '1', 'PX', ttlMs, 'NX');
            return set === null;
        }
        catch {
            // fall through to memory
        }
    }
    const now = Date.now();
    const existing = memoryCache.get(cacheKey);
    if (existing && now - existing < ttlMs)
        return true;
    memoryCache.set(cacheKey, now, { ttl: ttlMs });
    return false;
}
export function resetIdempotencyStoreForTests() {
    memoryCache.clear();
}
//# sourceMappingURL=idempotency-store.js.map
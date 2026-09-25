/**
 * OAuth JWT revocation denylist (jti / token hash).
 * Memory always; Redis when configured (MASTYF_AI_TOKEN_REVOCATION_REDIS=true).
 */
import { createHash } from 'crypto';
import { Logger } from '../utils/logger.js';
import { createRedisClient, isRedisConfigured } from '../utils/redis-client.js';
const MAX_MEMORY_DENYLIST_SIZE = 10_000;
const memoryDenylist = new Map();
const DEFAULT_TTL_MS = 86_400_000;
const REDIS_KEY_PREFIX = 'mastyf-ai:revoked:';
let revocationRedis = null;
function keyForToken(token, jti) {
    if (jti)
        return `jti:${jti}`;
    return `hash:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}
function ttlMs() {
    const n = parseInt(process.env['MASTYF_AI_TOKEN_REVOCATION_TTL_MS'] || String(DEFAULT_TTL_MS), 10);
    return Number.isFinite(n) && n > 60_000 ? n : DEFAULT_TTL_MS;
}
function useRedisRevocation() {
    return (process.env['MASTYF_AI_TOKEN_REVOCATION'] !== 'false'
        && process.env['MASTYF_AI_TOKEN_REVOCATION_REDIS'] !== 'false'
        && isRedisConfigured());
}
function getRevocationRedis() {
    if (!useRedisRevocation())
        return null;
    if (!revocationRedis) {
        revocationRedis = createRedisClient({ maxRetriesPerRequest: 2, lazyConnect: false });
    }
    return revocationRedis;
}
function redisKey(key) {
    return `${REDIS_KEY_PREFIX}${key}`;
}
export async function revokeBearerToken(token, jti) {
    const key = keyForToken(token, jti);
    const exp = Date.now() + ttlMs();
    // Enforce max size to prevent unbounded memory growth
    if (memoryDenylist.size >= MAX_MEMORY_DENYLIST_SIZE) {
        cleanupRevokedTokens();
    }
    if (memoryDenylist.size >= MAX_MEMORY_DENYLIST_SIZE) {
        // Still full after cleanup — evict oldest entries
        const iter = memoryDenylist.keys();
        const toRemove = Math.max(1, Math.floor(MAX_MEMORY_DENYLIST_SIZE * 0.1));
        for (let i = 0; i < toRemove; i++) {
            const oldest = iter.next();
            if (oldest.done)
                break;
            memoryDenylist.delete(oldest.value);
        }
    }
    memoryDenylist.set(key, exp);
    const redis = getRevocationRedis();
    if (redis) {
        try {
            await redis.set(redisKey(key), '1', 'PX', ttlMs());
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            Logger.warn(`[auth] Redis token revocation write failed: ${msg}`);
        }
    }
    Logger.info(`[auth] Token revoked: ${jti || key.slice(0, 12)}`);
}
export async function isBearerTokenRevoked(token, jti) {
    if (process.env['MASTYF_AI_TOKEN_REVOCATION'] === 'false')
        return false;
    const key = keyForToken(token, jti);
    const exp = memoryDenylist.get(key);
    if (exp) {
        if (Date.now() > exp) {
            memoryDenylist.delete(key);
        }
        else {
            return true;
        }
    }
    const redis = getRevocationRedis();
    if (redis) {
        try {
            const hit = await redis.get(redisKey(key));
            if (hit)
                return true;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            Logger.warn(`[auth] Redis token revocation read failed: ${msg}`);
        }
    }
    return false;
}
export function cleanupRevokedTokens() {
    const now = Date.now();
    for (const [k, exp] of memoryDenylist) {
        if (now > exp)
            memoryDenylist.delete(k);
    }
}
/** @internal */
export function resetTokenRevocationForTests() {
    memoryDenylist.clear();
    if (revocationRedis) {
        revocationRedis.disconnect();
        revocationRedis = null;
    }
}
//# sourceMappingURL=token-revocation.js.map
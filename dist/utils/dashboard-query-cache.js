/**
 * Redis-backed short TTL cache for expensive dashboard read queries.
 */
import { createHash } from 'crypto';
import { isRedisConfigured, getSharedRedisClient } from './redis-client.js';
import { Logger } from './logger.js';
const localCache = new Map();
function defaultTtlMs() {
    const n = parseInt(process.env['MASTYF_AI_DASHBOARD_QUERY_CACHE_TTL_MS'] || '15000', 10);
    return Number.isFinite(n) && n >= 0 ? n : 15000;
}
export function isDashboardQueryCacheEnabled() {
    if (process.env['MASTYF_AI_DASHBOARD_QUERY_CACHE'] === 'false')
        return false;
    return process.env['MASTYF_AI_DASHBOARD_QUERY_CACHE'] === 'true' || isRedisConfigured();
}
export function dashboardQueryCacheKey(parts) {
    const raw = Object.entries(parts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    return `dash-q:${createHash('sha256').update(raw).digest('hex').slice(0, 20)}`;
}
export async function getCachedDashboardQuery(key) {
    const now = Date.now();
    const local = localCache.get(key);
    if (local && local.expiresAt > now) {
        try {
            return JSON.parse(local.value);
        }
        catch {
            localCache.delete(key);
        }
    }
    if (!isRedisConfigured())
        return null;
    try {
        const redis = getSharedRedisClient();
        const raw = await redis.get(key);
        if (!raw)
            return null;
        localCache.set(key, { value: raw, expiresAt: now + defaultTtlMs() });
        return JSON.parse(raw);
    }
    catch (err) {
        Logger.debug(`[dashboard-query-cache] get failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
export async function setCachedDashboardQuery(key, value) {
    const ttl = defaultTtlMs();
    if (ttl <= 0)
        return;
    const raw = JSON.stringify(value);
    localCache.set(key, { value: raw, expiresAt: Date.now() + ttl });
    if (!isRedisConfigured())
        return;
    try {
        const redis = getSharedRedisClient();
        await redis.set(key, raw, 'PX', ttl);
    }
    catch (err) {
        Logger.debug(`[dashboard-query-cache] set failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
export async function cachedDashboardQuery(key, loader) {
    if (!isDashboardQueryCacheEnabled())
        return loader();
    const hit = await getCachedDashboardQuery(key);
    if (hit != null)
        return hit;
    const value = await loader();
    await setCachedDashboardQuery(key, value);
    return value;
}
/** @internal */
export function resetDashboardQueryCacheForTests() {
    localCache.clear();
}
//# sourceMappingURL=dashboard-query-cache.js.map
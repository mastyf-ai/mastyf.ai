/**
 * Per-tenant daily budget — atomic pre-call reservation (Redis) + in-process debit.
 */
import { getDailyBudgetCapUsd } from './cost-auditor.js';
import { Logger } from '../utils/logger.js';
import { isRedisConfigured, getSharedRedisClient } from '../utils/redis-client.js';
const spendByTenantDay = new Map();
const REDIS_PREFIX = 'mastyf_ai:tenant_budget:';
function utcDayKey() {
    return new Date().toISOString().slice(0, 10);
}
function cacheKey(tenantId) {
    return `${utcDayKey()}:${tenantId}`;
}
function redisKey(tenantId) {
    return `${REDIS_PREFIX}${cacheKey(tenantId)}`;
}
function ttlSecondsUntilUtcMidnight() {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return Math.max(60, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
}
/** Record USD spend after a persisted call (proxy hot path). */
export function recordTenantDailySpend(tenantId, costUsd) {
    if (!costUsd || costUsd <= 0)
        return;
    const tid = tenantId?.trim() || 'default';
    const key = cacheKey(tid);
    spendByTenantDay.set(key, (spendByTenantDay.get(key) ?? 0) + costUsd);
    if (isRedisConfigured()) {
        void (async () => {
            try {
                const redis = getSharedRedisClient();
                const microUsd = Math.ceil(costUsd * 1_000_000);
                await redis.incrby(redisKey(tid), microUsd);
                await redis.expire(redisKey(tid), ttlSecondsUntilUtcMidnight());
            }
            catch {
                /* best-effort Redis sync */
            }
        })();
    }
}
export function getEstimatedSemanticCostUsd() {
    const v = parseFloat(process.env.MASTYF_AI_SEMANTIC_ESTIMATED_COST_USD || '0.003');
    return Number.isFinite(v) && v > 0 ? v : 0.003;
}
/** Legacy projected check (non-atomic). Prefer tryReserveTenantDailyBudget. */
export function isTenantDailyBudgetExceeded(tenantId, additionalUsd = 0) {
    const tid = tenantId?.trim() || 'default';
    const capUsd = getDailyBudgetCapUsd(tid);
    if (capUsd <= 0) {
        return { exceeded: false, spentUsd: 0, capUsd: 0 };
    }
    const spentUsd = spendByTenantDay.get(cacheKey(tid)) ?? 0;
    const projected = spentUsd + additionalUsd;
    if (projected >= capUsd) {
        Logger.warn(`[tenant-budget] Tenant ${tid} daily cap exceeded (${projected.toFixed(4)} >= ${capUsd} USD)`);
        return { exceeded: true, spentUsd, capUsd };
    }
    return { exceeded: false, spentUsd, capUsd };
}
/**
 * Atomically reserve daily budget before forwarding LLM / tool work.
 * Returns false when cap would be exceeded (TOCTOU-safe with Redis when configured).
 */
export async function tryReserveTenantDailyBudget(tenantId, costUsd) {
    if (!costUsd || costUsd <= 0)
        return true;
    const tid = tenantId?.trim() || 'default';
    const capUsd = getDailyBudgetCapUsd(tid);
    if (capUsd <= 0)
        return true;
    const microUsd = Math.ceil(costUsd * 1_000_000);
    const capMicroUsd = Math.ceil(capUsd * 1_000_000);
    if (isRedisConfigured()) {
        try {
            const redis = getSharedRedisClient();
            const key = redisKey(tid);
            const script = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local cap = tonumber(ARGV[1])
local delta = tonumber(ARGV[2])
if current + delta > cap then
  return 0
end
redis.call('INCRBY', KEYS[1], delta)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1`;
            const ok = await redis.eval(script, 1, key, capMicroUsd, microUsd, ttlSecondsUntilUtcMidnight());
            if (ok === 1) {
                spendByTenantDay.set(cacheKey(tid), (spendByTenantDay.get(cacheKey(tid)) ?? 0) + costUsd);
                return true;
            }
            Logger.warn(`[tenant-budget] Redis reserve denied for tenant ${tid}`);
            return false;
        }
        catch (err) {
            if (process.env['MASTYF_AI_STRICT_MODE'] === 'true') {
                Logger.error(`[tenant-budget] Redis reserve failed in strict mode: ${err instanceof Error ? err.message : String(err)}`);
                return false;
            }
        }
    }
    const key = cacheKey(tid);
    const spentUsd = spendByTenantDay.get(key) ?? 0;
    if (spentUsd + costUsd >= capUsd) {
        Logger.warn(`[tenant-budget] Tenant ${tid} daily cap exceeded on reserve`);
        return false;
    }
    spendByTenantDay.set(key, spentUsd + costUsd);
    return true;
}
/** @internal tests */
export function resetTenantBudgetCacheForTests() {
    spendByTenantDay.clear();
}
//# sourceMappingURL=tenant-budget.js.map
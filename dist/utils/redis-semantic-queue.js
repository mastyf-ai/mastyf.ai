/**
 * Cluster-wide semantic scan concurrency caps (Redis Lua atomic INCR/DECR).
 * Used by async semantic audit and packages/core semantic queue when Redis is configured.
 */
import { Gauge } from 'prom-client';
import { isRedisConfigured, getSharedRedisClient } from './redis-client.js';
import { registry } from './metrics.js';
import { Logger } from './logger.js';
const GLOBAL_KEY = 'mastyf_ai:semantic:inflight';
const TENANT_PREFIX = 'mastyf_ai:semantic:tenant:';
export const semanticQueueBackendGauge = new Gauge({
    name: 'mastyf_ai_semantic_queue_backend',
    help: '1 when semantic queue uses Redis (0 = process-local)',
    labelNames: ['backend'],
    registers: [registry],
});
function useLocalQueue() {
    return process.env['MASTYF_AI_SEMANTIC_QUEUE_LOCAL'] === 'true' || !isRedisConfigured();
}
export function isRedisSemanticQueueEnabled() {
    return !useLocalQueue();
}
export function semanticQueueMax() {
    const n = parseInt(process.env['MASTYF_AI_SEMANTIC_ASYNC_MAX_QUEUE'] ||
        process.env['MASTYF_AI_SEMANTIC_MAX_QUEUE'] ||
        '1000', 10);
    return Number.isFinite(n) && n > 0 ? n : 1000;
}
export function semanticPerTenantMax() {
    const n = parseInt(process.env['MASTYF_AI_SEMANTIC_PER_TENANT_MAX'] || '50', 10);
    return Number.isFinite(n) && n > 0 ? n : 50;
}
const ACQUIRE_SCRIPT = `
local globalKey = KEYS[1]
local tenantKey = KEYS[2]
local globalMax = tonumber(ARGV[1])
local tenantMax = tonumber(ARGV[2])
local hasTenant = ARGV[3] == '1'
local global = tonumber(redis.call('GET', globalKey) or '0')
if global >= globalMax then return 0 end
if hasTenant == true then
  local tenant = tonumber(redis.call('GET', tenantKey) or '0')
  if tenant >= tenantMax then return 0 end
  redis.call('INCR', tenantKey)
  redis.call('EXPIRE', tenantKey, 3600)
end
redis.call('INCR', globalKey)
redis.call('EXPIRE', globalKey, 3600)
return 1`;
const RELEASE_SCRIPT = `
local globalKey = KEYS[1]
local tenantKey = KEYS[2]
local hasTenant = ARGV[1] == '1'
local g = tonumber(redis.call('GET', globalKey) or '0')
if g > 0 then redis.call('DECR', globalKey) end
if hasTenant == true then
  local t = tonumber(redis.call('GET', tenantKey) or '0')
  if t > 0 then redis.call('DECR', tenantKey) end
end
return 1`;
function tenantRedisKey(tenantId) {
    return `${TENANT_PREFIX}${tenantId}:inflight`;
}
export async function tryAcquireRedisSemanticSlot(tenantId) {
    if (useLocalQueue())
        return true;
    try {
        const redis = getSharedRedisClient();
        const tid = tenantId?.trim();
        const hasTenant = Boolean(tid);
        const ok = await redis.eval(ACQUIRE_SCRIPT, 2, GLOBAL_KEY, hasTenant ? tenantRedisKey(tid) : GLOBAL_KEY, semanticQueueMax(), semanticPerTenantMax(), hasTenant ? '1' : '0');
        semanticQueueBackendGauge.set({ backend: 'redis' }, 1);
        semanticQueueBackendGauge.set({ backend: 'local' }, 0);
        return ok === 1;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.warn(`[redis-semantic-queue] acquire failed: ${msg}`);
        if (process.env['MASTYF_AI_STRICT_MODE'] === 'true')
            return false;
        return true;
    }
}
export async function releaseRedisSemanticSlot(tenantId) {
    if (useLocalQueue())
        return;
    try {
        const redis = getSharedRedisClient();
        const tid = tenantId?.trim();
        const hasTenant = Boolean(tid);
        await redis.eval(RELEASE_SCRIPT, 2, GLOBAL_KEY, hasTenant ? tenantRedisKey(tid) : GLOBAL_KEY, hasTenant ? '1' : '0');
    }
    catch {
        /* best-effort */
    }
}
export async function getRedisSemanticQueueDepth() {
    if (useLocalQueue())
        return 0;
    try {
        const redis = getSharedRedisClient();
        const v = await redis.get(GLOBAL_KEY);
        return parseInt(v || '0', 10) || 0;
    }
    catch {
        return 0;
    }
}
let localWarned = false;
/** Warn once when process-local caps are used in enterprise/multi-replica posture. */
export function warnLocalSemanticQueueCapsIfNeeded() {
    if (localWarned || !useLocalQueue())
        return;
    const enterprise = process.env['MASTYF_AI_ENTERPRISE_MODE'] === 'true' ||
        process.env['MASTYF_AI_STRICT_MODE'] === 'true';
    if (!enterprise)
        return;
    localWarned = true;
    Logger.warn('[redis-semantic-queue] Semantic queue caps are per-process; configure REDIS_URL for cluster-wide enforcement (M-001)');
    semanticQueueBackendGauge.set({ backend: 'local' }, 1);
    semanticQueueBackendGauge.set({ backend: 'redis' }, 0);
}
//# sourceMappingURL=redis-semantic-queue.js.map
/**
 * Cluster-wide scan concurrency caps (M-001) — mirrors semantic-queue Redis Lua pattern.
 */
import { Redis } from "ioredis";
const GLOBAL_KEY = "mastyf_ai:scan:inflight";
let redis = null;
function isRedisConfigured() {
    return !!(process.env["REDIS_URL"] ||
        process.env["REDIS_SENTINELS"] ||
        process.env["REDIS_CLUSTER_NODES"]);
}
function useLocalSemaphore() {
    return process.env["MASTYF_AI_SCAN_QUEUE_LOCAL"] === "true" || !isRedisConfigured();
}
function getRedis() {
    if (!redis) {
        redis = new Redis(process.env["REDIS_URL"] || "redis://127.0.0.1:6379", {
            maxRetriesPerRequest: 2,
            lazyConnect: false,
        });
    }
    return redis;
}
const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local cur = tonumber(redis.call('GET', key) or '0')
if cur >= max then return 0 end
redis.call('INCR', key)
redis.call('EXPIRE', key, 3600)
return 1`;
const RELEASE_SCRIPT = `
local key = KEYS[1]
local cur = tonumber(redis.call('GET', key) or '0')
if cur > 0 then redis.call('DECR', key) end
return 1`;
export function isRedisScanConcurrencyEnabled() {
    return !useLocalSemaphore();
}
export async function tryAcquireScanSlot(max) {
    if (useLocalSemaphore())
        return true;
    try {
        const ok = await getRedis().eval(ACQUIRE_SCRIPT, 1, GLOBAL_KEY, max);
        return ok === 1;
    }
    catch {
        if (process.env["MASTYF_AI_STRICT_MODE"] === "true")
            return false;
        return true;
    }
}
export async function releaseScanSlot() {
    if (useLocalSemaphore())
        return;
    try {
        await getRedis().eval(RELEASE_SCRIPT, 1, GLOBAL_KEY);
    }
    catch {
        /* best-effort */
    }
}
/** @internal */
export function resetRedisScanConcurrencyForTests() {
    if (redis) {
        redis.disconnect();
        redis = null;
    }
}
//# sourceMappingURL=redis-scan-concurrency.js.map
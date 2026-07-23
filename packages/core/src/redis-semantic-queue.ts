/**
 * Cluster-wide semantic scan caps for @mastyf_ai/core (Redis Lua).
 */
import { Redis } from "ioredis";

const GLOBAL_KEY = "mastyf_ai:semantic:inflight";
const TENANT_PREFIX = "mastyf_ai:semantic:tenant:";

let redis: Redis | null = null;

export function isRedisConfigured(): boolean {
  return !!(
    process.env["REDIS_URL"] ||
    process.env["REDIS_SENTINELS"] ||
    process.env["REDIS_CLUSTER_NODES"]
  );
}

function useLocalQueue(): boolean {
  return process.env["MASTYF_AI_SEMANTIC_QUEUE_LOCAL"] === "true" || !isRedisConfigured();
}

export function isRedisSemanticQueueEnabled(): boolean {
  return !useLocalQueue();
}

function getRedis(): Redis {
  if (!redis) {
    const url = process.env["REDIS_URL"] || "redis://127.0.0.1:6379";
    redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  }
  return redis;
}

export function semanticQueueMax(): number {
  const n = parseInt(
    process.env["MASTYF_AI_SEMANTIC_ASYNC_MAX_QUEUE"] ||
      process.env["MASTYF_AI_SEMANTIC_MAX_QUEUE"] ||
      "1000",
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

export function semanticPerTenantMax(): number {
  const n = parseInt(process.env["MASTYF_AI_SEMANTIC_PER_TENANT_MAX"] || "50", 10);
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

function tenantRedisKey(tenantId: string): string {
  return `${TENANT_PREFIX}${tenantId}:inflight`;
}

export async function tryAcquireRedisSemanticSlot(tenantId?: string): Promise<boolean> {
  if (useLocalQueue()) return true;
  try {
    const client = getRedis();
    const tid = tenantId?.trim();
    const hasTenant = Boolean(tid);
    const ok = await client.eval(
      ACQUIRE_SCRIPT,
      2,
      GLOBAL_KEY,
      hasTenant ? tenantRedisKey(tid!) : GLOBAL_KEY,
      semanticQueueMax(),
      semanticPerTenantMax(),
      hasTenant ? "1" : "0",
    );
    return ok === 1;
  } catch {
    if (process.env["MASTYF_AI_STRICT_MODE"] === "true") return false;
    return true;
  }
}

export async function releaseRedisSemanticSlot(tenantId?: string): Promise<void> {
  if (useLocalQueue()) return;
  try {
    const client = getRedis();
    const tid = tenantId?.trim();
    const hasTenant = Boolean(tid);
    await client.eval(
      RELEASE_SCRIPT,
      2,
      GLOBAL_KEY,
      hasTenant ? tenantRedisKey(tid!) : GLOBAL_KEY,
      hasTenant ? "1" : "0",
    );
  } catch {
    /* best-effort */
  }
}

/** @internal */
export function resetRedisSemanticQueueForTests(): void {
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}

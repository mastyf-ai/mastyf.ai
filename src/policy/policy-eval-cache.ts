/**
 * Distributed policy evaluation cache (Redis) — mirrors OPA LRU pattern for full YAML decisions.
 * Key: tenant + server + tool + args hash. TTL: GUARDIAN_POLICY_EVAL_CACHE_TTL_MS (default 5000).
 */
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import type { CallContext, PolicyDecision } from './policy-types.js';
import { isRedisConfigured, getSharedRedisClient } from '../utils/redis-client.js';
import { Logger } from '../utils/logger.js';

type CacheEntry = { decision: PolicyDecision; expiresAt: number };

const localCache = new LRUCache<string, CacheEntry>({ max: 2000 });

function cacheTtlMs(): number {
  const n = parseInt(process.env['GUARDIAN_POLICY_EVAL_CACHE_TTL_MS'] || '5000', 10);
  return Number.isFinite(n) && n >= 0 ? n : 5000;
}

function argsHash(args: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex').slice(0, 16);
  } catch {
    return '0';
  }
}

export function policyEvalCacheKey(ctx: CallContext): string {
  const tenant = ctx.tenantId || 'default';
  return `policy-eval:${tenant}:${ctx.serverName}:${ctx.toolName}:${argsHash(ctx.arguments)}`;
}

export function isPolicyEvalCacheEnabled(): boolean {
  if (process.env['GUARDIAN_POLICY_EVAL_CACHE'] === 'false') return false;
  return process.env['GUARDIAN_POLICY_EVAL_CACHE'] === 'true' || isRedisConfigured();
}

const NON_CACHEABLE_RULE_PREFIXES = ['rate', 'idempotency', 'redis-rate', 'timing'];

/** Stateful / time-varying decisions must not be cached. */
export function shouldCachePolicyDecision(decision: PolicyDecision): boolean {
  const rule = decision.rule.toLowerCase();
  if (NON_CACHEABLE_RULE_PREFIXES.some((p) => rule.includes(p))) return false;
  if (decision.reason.toLowerCase().includes('rate limit')) return false;
  if (decision.reason.toLowerCase().includes('timing')) return false;
  return true;
}

export function resetPolicyEvalCacheForTests(): void {
  localCache.clear();
}

export async function getCachedPolicyDecision(key: string): Promise<PolicyDecision | null> {
  const ttl = cacheTtlMs();
  if (ttl <= 0) return null;

  const local = localCache.get(key);
  if (local && local.expiresAt > Date.now()) return local.decision;

  if (!isRedisConfigured()) return null;

  try {
    const redis = getSharedRedisClient();
    const raw = await redis.get(key);
    if (!raw) return null;
    const decision = JSON.parse(raw) as PolicyDecision;
    localCache.set(key, { decision, expiresAt: Date.now() + ttl });
    return decision;
  } catch (err: unknown) {
    Logger.debug(
      `[policy-eval-cache] redis get failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export async function setCachedPolicyDecision(
  key: string,
  decision: PolicyDecision,
): Promise<void> {
  const ttl = cacheTtlMs();
  if (ttl <= 0) return;

  localCache.set(key, { decision, expiresAt: Date.now() + ttl });

  if (!isRedisConfigured()) return;

  try {
    const redis = getSharedRedisClient();
    await redis.set(key, JSON.stringify(decision), 'PX', ttl);
  } catch (err: unknown) {
    Logger.debug(
      `[policy-eval-cache] redis set failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

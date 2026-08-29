/**
 * Per-tenant rate limit for semantic LLM API calls (count + optional USD/min cap).
 */
import { Counter } from 'prom-client';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { getEstimatedSemanticCostUsd } from '../services/tenant-budget.js';
import { registry } from '../utils/metrics.js';
import { isRedisConfigured } from '../utils/redis-client.js';
import { getSharedRedisRateLimiter } from '../utils/redis-rate-limiter.js';

const WINDOW_MS = 60_000;

type LocalBucket = { count: number; usd: number; resetAt: number };
const localBuckets = new Map<string, LocalBucket>();

export const semanticAuditSkippedTotal = new Counter({
  name: 'mastyf_ai_semantic_audit_skipped_total',
  help: 'Semantic audit skipped (circuit, rate limit, no API key)',
  labelNames: ['reason', 'tenant_id'],
  registers: [registry],
});

function getMaxPerMin(opts?: { async?: boolean }): number {
  if (opts?.async) {
    return parseInt(process.env.MASTYF_AI_SEMANTIC_ASYNC_MAX_PER_MIN || process.env.MASTYF_AI_SEMANTIC_LLM_MAX_PER_MIN || '60', 10);
  }
  return parseInt(process.env.MASTYF_AI_SEMANTIC_LLM_MAX_PER_MIN || '10', 10);
}

export function getAsyncMaxPerMin(): number {
  return getMaxPerMin({ async: true });
}

export function reportSemanticAuditSkipped(
  reason: string,
  tenantId?: string,
): void {
  semanticAuditSkippedTotal.inc({
    reason,
    tenant_id: tenantId?.trim() || DEFAULT_TENANT_ID,
  });
}

export function getSemanticLlmMaxUsdPerMin(opts?: { async?: boolean }): number {
  const key = opts?.async ? 'MASTYF_AI_SEMANTIC_ASYNC_MAX_USD_PER_MIN' : 'MASTYF_AI_SEMANTIC_LLM_MAX_USD_PER_MIN';
  const explicit = parseFloat(process.env[key] || '0');
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return getEstimatedSemanticCostUsd() * getMaxPerMin(opts);
}

export function getAsyncMaxUsdPerMin(): number {
  return getSemanticLlmMaxUsdPerMin({ async: true });
}

function localBucketKey(tenantId: string, kind: string): string {
  return `${tenantId}:${kind}`;
}

function getLocalBucket(tenantId: string, kind: string): LocalBucket {
  const bucketKey = localBucketKey(tenantId, kind);
  const now = Date.now();
  let b = localBuckets.get(bucketKey);
  if (!b || now >= b.resetAt) {
    b = { count: 0, usd: 0, resetAt: now + WINDOW_MS };
    localBuckets.set(bucketKey, b);
  }
  return b;
}

async function checkRedisLimits(
  tenantId: string,
  estimatedUsd: number,
  opts?: { async?: boolean },
): Promise<boolean> {
  const rl = getSharedRedisRateLimiter();
  const maxUsd = getSemanticLlmMaxUsdPerMin(opts);
  const maxPerMin = getMaxPerMin(opts);

  if (maxUsd > 0 && estimatedUsd > 0) {
    const usdKey = 'semantic-llm-usd';
    const microUsd = Math.ceil(estimatedUsd * 1_000_000);
    const maxMicroUsd = Math.ceil(maxUsd * 1_000_000);
    const usdResult = await rl.checkAndIncrement(
      usdKey,
      maxMicroUsd,
      WINDOW_MS,
      tenantId,
      microUsd,
    );
    if (!usdResult.allowed) return false;
  }

  const countKey = 'semantic-llm';
  const countResult = await rl.checkAndIncrement(
    countKey,
    maxPerMin,
    WINDOW_MS,
    tenantId,
  );
  return countResult.allowed;
}

export async function allowSemanticLlmCall(tenantId?: string, opts?: { async?: boolean }): Promise<boolean> {
  const tid = tenantId?.trim() || DEFAULT_TENANT_ID;
  const estimatedUsd = getEstimatedSemanticCostUsd();
  const maxPerMin = getMaxPerMin(opts);

  let allowed = false;
  if (isRedisConfigured()) {
    try {
      allowed = await checkRedisLimits(tid, estimatedUsd, opts);
      void import('../alerting/incident-responder.js').then(({ trackLlmHealth }) => {
        trackLlmHealth(true);
      }).catch(() => undefined);
      return allowed;
    } catch {
      void import('../alerting/incident-responder.js').then(({ trackLlmHealth }) => {
        trackLlmHealth(false);
      }).catch(() => undefined);
      /* fall through to local */
    }
  }

  const kind = opts?.async ? 'semantic-llm-async' : 'semantic-llm';
  const usdKind = opts?.async ? 'semantic-llm-async-usd' : 'semantic-llm-usd';
  const countBucket = getLocalBucket(tid, kind);
  if (countBucket.count >= maxPerMin) return false;

  const maxUsd = getSemanticLlmMaxUsdPerMin(opts);
  if (maxUsd > 0 && estimatedUsd > 0) {
    const usdBucket = getLocalBucket(tid, usdKind);
    if (usdBucket.usd + estimatedUsd > maxUsd) return false;
    usdBucket.usd += estimatedUsd;
  }

  countBucket.count++;
  return true;
}

/** @internal */
export function resetSemanticLlmRateLimitForTests(): void {
  localBuckets.clear();
}

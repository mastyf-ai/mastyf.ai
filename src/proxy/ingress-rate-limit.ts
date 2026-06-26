import { getSharedRedisRateLimiter } from '../utils/redis-rate-limiter.js';
import { isRedisConfigured } from '../utils/redis-client.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';

const WINDOW_MS = 60_000;

function ingressMaxPerMinute(): number {
  const raw = process.env['MASTYF_AI_INGRESS_RATE_LIMIT_MAX'];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Global ingress flood limit (independent of per-client/tool limits). Off when env unset. */
export async function checkIngressRateLimit(
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<{ allowed: boolean; reason?: string }> {
  const max = ingressMaxPerMinute();
  if (max <= 0) {
    if (process.env['MASTYF_AI_GLOBAL_RATE_LIMIT_REQUIRED'] === 'true' && !isRedisConfigured()) {
      return { allowed: false, reason: 'Ingress rate limit backend unavailable' };
    }
    return { allowed: true };
  }
  if (!isRedisConfigured()) {
    if (process.env['MASTYF_AI_GLOBAL_RATE_LIMIT_REQUIRED'] === 'true') {
      return { allowed: false, reason: 'Ingress rate limit backend unavailable' };
    }
    return { allowed: true };
  }
  const rl = getSharedRedisRateLimiter();
  const result = await rl.checkAndIncrement('ingress:global', max, WINDOW_MS, tenantId);
  if (!result.allowed) {
    return { allowed: false, reason: `Ingress rate limit exceeded (${max}/min)` };
  }
  return { allowed: true };
}

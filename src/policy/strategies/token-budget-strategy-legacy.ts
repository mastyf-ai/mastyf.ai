import { isRedisConfigured } from '../../utils/redis-client.js';
import { getSharedRedisRateLimiter } from '../../utils/redis-rate-limiter.js';
import type { CallContext, PolicyDecision } from '../policy-types.js';
import type { PolicyEngineDeps } from './types.js';

const WINDOW_MS = 60_000;

export interface TokenBudgetStrategyResult {
  decision: PolicyDecision | null;
}

/** Legacy Redis-backed per-minute token and USD caps from YAML rules. */
export async function evaluateRedisTokenBudgetLegacy(
  context: CallContext,
  deps: PolicyEngineDeps,
): Promise<TokenBudgetStrategyResult> {
  if (!isRedisConfigured()) {
    return { decision: null };
  }

  const tenant = context.tenantId || process.env['MASTYF_AI_TENANT_ID'] || 'default';
  const tokens = context.requestTokens ?? 0;
  if (tokens <= 0) return { decision: null };

  try {
    const rl = getSharedRedisRateLimiter();
    for (const rule of deps.rules) {
      if (rule.enabled === false) continue;

      if (rule.maxTokensPerMinute) {
        const key = `token-budget:${rule.name}`;
        const { allowed } = await rl.checkAndIncrement(
          key,
          rule.maxTokensPerMinute,
          WINDOW_MS,
          tenant,
          tokens,
        );
        if (!allowed) {
          return {
            decision: {
              action: deps.resolveAction(rule.action),
              rule: rule.name,
              reason: `Token budget exceeded: ${rule.maxTokensPerMinute} tokens per minute (cluster)`,
            },
          };
        }
      }

      if (rule.maxUsdPerMinute) {
        const usdKey = `usd-budget:${rule.name}`;
        const microUsd = Math.max(1, Math.ceil(tokens * 0.000002 * 1_000_000));
        const capMicro = Math.ceil(rule.maxUsdPerMinute * 1_000_000);
        const { allowed } = await rl.checkAndIncrement(
          usdKey,
          capMicro,
          WINDOW_MS,
          tenant,
          microUsd,
        );
        if (!allowed) {
          return {
            decision: {
              action: deps.resolveAction(rule.action),
              rule: rule.name,
              reason: `USD budget exceeded: $${rule.maxUsdPerMinute}/min (cluster)`,
            },
          };
        }
      }
    }
    return { decision: null };
  } catch {
    return { decision: null };
  }
}

import type { CallContext, PolicyDecision } from '../policy-types.js';
import type { PolicyEngineDeps } from './types.js';

export interface TokenBudgetStrategyResult {
  decision: PolicyDecision | null;
}

/**
 * YAML token/USD per-minute caps are advisory — hard enforcement is unified-spend-pool.
 * Set MASTYF_AI_POLICY_TOKEN_BUDGET_ENFORCE=true to restore legacy Redis blocks.
 */
export async function evaluateRedisTokenBudget(
  context: CallContext,
  deps: PolicyEngineDeps,
): Promise<TokenBudgetStrategyResult> {
  if (process.env['MASTYF_AI_POLICY_TOKEN_BUDGET_ENFORCE'] !== 'true') {
    return { decision: null };
  }

  const { evaluateRedisTokenBudgetLegacy } = await import('./token-budget-strategy-legacy.js');
  return evaluateRedisTokenBudgetLegacy(context, deps);
}

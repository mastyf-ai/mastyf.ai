import type { CallContext, PolicyDecision } from '../policy-types.js';
import type { PolicyEngineDeps } from './types.js';
export interface TokenBudgetStrategyResult {
    decision: PolicyDecision | null;
}
/** Legacy Redis-backed per-minute token and USD caps from YAML rules. */
export declare function evaluateRedisTokenBudgetLegacy(context: CallContext, deps: PolicyEngineDeps): Promise<TokenBudgetStrategyResult>;
//# sourceMappingURL=token-budget-strategy-legacy.d.ts.map
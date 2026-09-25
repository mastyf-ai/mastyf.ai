import type { CallContext, PolicyDecision } from '../policy-types.js';
import type { PolicyEngineDeps } from './types.js';
export interface RateLimitStrategyResult {
    decision: PolicyDecision | null;
    skipLocalRateLimit: boolean;
}
/** Cluster Redis rate limits (returns early block decision when exceeded). */
export declare function evaluateRedisRateLimit(context: CallContext, deps: PolicyEngineDeps): Promise<RateLimitStrategyResult>;
//# sourceMappingURL=rate-limit-strategy.d.ts.map
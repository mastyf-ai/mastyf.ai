import type { CallContext, PolicyDecision } from './policy-types.js';
export declare function policyEvalCacheKey(ctx: CallContext): string;
export declare function isPolicyEvalCacheEnabled(): boolean;
/** Opt-in: only cache explicit allowlist passes unless legacy heuristic enabled. */
export declare function shouldCachePolicyDecision(decision: PolicyDecision, opts?: {
    ruleCacheable?: boolean;
}): boolean;
export declare function resetPolicyEvalCacheForTests(): void;
export declare function getCachedPolicyDecision(key: string, tenantId?: string): Promise<PolicyDecision | null>;
export declare function setCachedPolicyDecision(key: string, decision: PolicyDecision): Promise<void>;
//# sourceMappingURL=policy-eval-cache.d.ts.map
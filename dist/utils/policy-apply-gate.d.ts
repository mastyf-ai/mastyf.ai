import type { PolicyRule } from '../policy/policy-types.js';
export interface PolicyApplyGateResult {
    allowed: boolean;
    reason?: string;
    simulationSummary?: string;
}
export declare function requirePolicySimulationBeforeApply(opts: {
    draftRule: PolicyRule;
    policyPath?: string;
    tenantId?: string;
    skip?: boolean;
}): Promise<PolicyApplyGateResult>;
//# sourceMappingURL=policy-apply-gate.d.ts.map
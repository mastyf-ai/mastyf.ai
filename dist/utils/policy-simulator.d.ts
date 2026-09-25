import { type CounterfactualReport } from '../ai/policy-counterfactual.js';
import { type BenchmarkScorecard } from './mastyf-ai-bench.js';
import type { PolicyRule } from '../policy/policy-types.js';
export interface PolicySimulationReport {
    generatedAt: string;
    counterfactual: CounterfactualReport;
    harnessReplay: BenchmarkScorecard;
    policyDiffSummary?: string;
    combinedSummary: string;
}
export declare function simulatePolicyChange(opts: {
    draftRule?: PolicyRule;
    policyPath?: string;
    existingPolicyYaml?: string;
    generatedPolicyYaml?: string;
    tenantId?: string;
    windowDays?: number;
    benchProfile?: string;
}): Promise<PolicySimulationReport>;
export type { BenchmarkScorecard } from './mastyf-ai-bench.js';
export type { CounterfactualReport } from '../ai/policy-counterfactual.js';
//# sourceMappingURL=policy-simulator.d.ts.map
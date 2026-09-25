import type { PolicyRule } from '../policy/policy-types.js';
import { type ReplaySample } from './counterfactual-replay-source.js';
export type CounterfactualDelta = {
    id: string;
    toolName: string;
    serverName: string;
    timestamp: string;
    argSource: ReplaySample['source'];
    baselineAction: 'block' | 'flag' | 'pass';
    counterfactualAction: 'block' | 'flag' | 'pass';
    changed: boolean;
    direction: 'new_block' | 'new_pass' | 'unchanged';
    baselineRule?: string;
    counterfactualRule?: string;
};
export type CounterfactualReport = {
    generatedAt: string;
    windowDays: number;
    sampleCount: number;
    newBlocks: number;
    newPasses: number;
    unchanged: number;
    fpRiskScore: number;
    argSources: {
        storedArgs: number;
        corpusMatch: number;
        empty: number;
    };
    deltas: CounterfactualDelta[];
    summary: string;
};
export declare function simulatePolicyCounterfactual(opts: {
    draftRule?: PolicyRule;
    policyPath?: string;
    tenantId?: string;
    windowDays?: number;
    limit?: number;
}): Promise<CounterfactualReport>;
//# sourceMappingURL=policy-counterfactual.d.ts.map
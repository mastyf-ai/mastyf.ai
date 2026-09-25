import type { PolicyRule } from '../policy/policy-types.js';
import { evaluateAutopilotSafety } from './autopilot-safety-contract.js';
import { scorePolicyImpact, type PolicyImpactInputs } from './policy-impact-scoring.js';
export interface ApprovalPreviewInput {
    suggestionId: string;
    source: 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern' | 'attack';
    rule: PolicyRule;
    actor: string;
    stage: 'shadow' | 'canary' | 'enforce';
    evidence: PolicyImpactInputs & {
        canarySizePercent: number;
        simulationPassed: boolean;
    };
}
export interface ApprovalPreview {
    suggestionId: string;
    ruleName: string;
    actor: string;
    safety: ReturnType<typeof evaluateAutopilotSafety>;
    impact: ReturnType<typeof scorePolicyImpact>;
}
type RollbackLedgerEntry = {
    timestamp: string;
    suggestionId: string;
    ruleName: string;
    actor: string;
    reason: string;
};
export declare function buildApprovalPreview(input: ApprovalPreviewInput): ApprovalPreview;
export declare function appendRollbackLedger(entry: Omit<RollbackLedgerEntry, 'timestamp'>): void;
export declare function readRollbackLedger(limit?: number): RollbackLedgerEntry[];
export {};
//# sourceMappingURL=autopilot-approval.d.ts.map
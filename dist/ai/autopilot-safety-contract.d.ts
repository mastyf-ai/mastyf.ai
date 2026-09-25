import type { PolicyRule } from '../policy/policy-types.js';
export type AutopilotRolloutStage = 'shadow' | 'canary' | 'enforce';
export interface AutopilotProposalEvidence {
    simulationPassed: boolean;
    replayCoverage: number;
    confidence: number;
    predictedFalsePositiveDelta: number;
    predictedBypassDelta: number;
    blastRadiusPercent: number;
    rollbackConfidence: number;
    canarySizePercent: number;
}
export interface AutopilotProposal {
    suggestionId: string;
    rule: PolicyRule;
    source: 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern' | 'attack';
    stage: AutopilotRolloutStage;
    evidence: AutopilotProposalEvidence;
}
export interface AutopilotSafetyThresholds {
    minReplayCoverage: number;
    minConfidence: number;
    maxFalsePositiveDelta: number;
    maxBypassDelta: number;
    maxBlastRadiusPercent: number;
    minRollbackConfidence: number;
    maxCanarySizePercent: number;
}
export interface AutopilotSafetyDecision {
    allowed: boolean;
    blockers: string[];
    warnings: string[];
    thresholds: AutopilotSafetyThresholds;
}
export declare const DEFAULT_AUTOPILOT_THRESHOLDS: AutopilotSafetyThresholds;
export declare function loadAutopilotThresholds(): AutopilotSafetyThresholds;
export declare function evaluateAutopilotSafety(proposal: AutopilotProposal, thresholds?: AutopilotSafetyThresholds): AutopilotSafetyDecision;
//# sourceMappingURL=autopilot-safety-contract.d.ts.map
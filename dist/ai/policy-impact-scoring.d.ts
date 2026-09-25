export interface PolicyImpactInputs {
    confidence: number;
    replayCoverage: number;
    predictedFalsePositiveDelta: number;
    predictedBypassDelta: number;
    blastRadiusPercent: number;
    rollbackConfidence: number;
}
export interface PolicyImpactScore {
    securityGain: number;
    falsePositiveRisk: number;
    blastRadiusRisk: number;
    rollbackRisk: number;
    confidenceScore: number;
    overall: number;
    recommendation: 'promote' | 'canary_only' | 'hold';
}
export declare function scorePolicyImpact(input: PolicyImpactInputs): PolicyImpactScore;
//# sourceMappingURL=policy-impact-scoring.d.ts.map
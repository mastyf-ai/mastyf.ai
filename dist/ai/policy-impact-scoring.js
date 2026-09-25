function clamp01(v) {
    if (!Number.isFinite(v))
        return 0;
    return Math.max(0, Math.min(1, v));
}
export function scorePolicyImpact(input) {
    const confidenceScore = clamp01(input.confidence);
    const coverageScore = clamp01(input.replayCoverage);
    const securityGain = clamp01((coverageScore * 0.4) + (confidenceScore * 0.6) - Math.max(0, input.predictedBypassDelta * 4));
    const falsePositiveRisk = clamp01(Math.max(0, input.predictedFalsePositiveDelta) * 12.5);
    const blastRadiusRisk = clamp01(input.blastRadiusPercent * 2.5);
    const rollbackRisk = clamp01(1 - clamp01(input.rollbackConfidence));
    const weightedRisk = (falsePositiveRisk * 0.45) + (blastRadiusRisk * 0.35) + (rollbackRisk * 0.2);
    const overall = clamp01((securityGain * 0.65) + (confidenceScore * 0.2) - (weightedRisk * 0.55));
    let recommendation = 'hold';
    if (overall >= 0.7 && falsePositiveRisk <= 0.25 && blastRadiusRisk <= 0.35) {
        recommendation = 'promote';
    }
    else if (overall >= 0.45) {
        recommendation = 'canary_only';
    }
    return {
        securityGain: Math.round(securityGain * 1000) / 1000,
        falsePositiveRisk: Math.round(falsePositiveRisk * 1000) / 1000,
        blastRadiusRisk: Math.round(blastRadiusRisk * 1000) / 1000,
        rollbackRisk: Math.round(rollbackRisk * 1000) / 1000,
        confidenceScore: Math.round(confidenceScore * 1000) / 1000,
        overall: Math.round(overall * 1000) / 1000,
        recommendation,
    };
}
//# sourceMappingURL=policy-impact-scoring.js.map
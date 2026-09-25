import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { ThreatPredictor } from '../threat-prediction/predictor.js';
import type { RiskScorer } from '../threat-prediction/risk-scorer.js';
export interface InsuranceRiskInput {
    tenantId?: string;
    serverName: string;
    toolCount: number;
    networkExposure: number;
    recordsAtRisk: number;
    avgRecordValueUsd?: number;
    knownCves?: number;
    maxCvss?: number;
}
export interface InsuranceRiskReport {
    id: string;
    serverName: string;
    aleUsd: number;
    exposureScore: number;
    exploitProbability: number;
    blastRadiusUsd: number;
    riskTier: 'low' | 'medium' | 'high' | 'critical';
    underwriterSummary: string;
    forecastConfidence?: number;
    fleetChainMultiplier?: number;
    ecosystemThreatHeat?: number;
    generatedAt: string;
}
export declare class InsuranceRiskQuantifier {
    private readonly predictor?;
    private readonly riskScorer?;
    private readonly store?;
    constructor(predictor?: ThreatPredictor | undefined, riskScorer?: RiskScorer | undefined, store?: IndustryStandardStore | undefined);
    quantify(input: InsuranceRiskInput): InsuranceRiskReport;
    /** C4 — Incorporate A1 fleet chain alerts and B2 observatory threat heat. */
    private readFleetEcosystemSignals;
}
//# sourceMappingURL=risk-quantifier.d.ts.map
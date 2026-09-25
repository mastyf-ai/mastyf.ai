import type { ProxyCallRecord } from '../types.js';
export interface ToolDriftMetrics {
    serverTool: string;
    recentMeanTokens: number;
    priorMeanTokens: number;
    recentBlockRate: number;
    priorBlockRate: number;
    tokenChiSquare: number;
    tokenPValue: number;
    blockRateDelta: number;
    drifted: boolean;
}
export interface DriftReport {
    checkedAt: string;
    driftDetected: boolean;
    tools: ToolDriftMetrics[];
    fpRateDelta?: number;
}
export interface DriftState {
    lastReport?: DriftReport;
    frozen: boolean;
    frozenAt?: string;
}
/** Binned chi-square comparing two token distributions. */
export declare function chiSquareBins(observed: number[], expected: number[]): {
    statistic: number;
    pValue: number;
};
export declare function detectDrift(records: ProxyCallRecord[], opts?: {
    labeledFpRateRecent?: number;
    labeledFpRatePrior?: number;
}): DriftReport;
export declare function isDriftOverrideEnabled(): boolean;
export declare function shouldFreezeThresholdAdjustments(drift: DriftState | undefined): boolean;
//# sourceMappingURL=drift-detector.d.ts.map
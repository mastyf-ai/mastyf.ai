/**
 * Cost coverage metrics — honest labeling for partial pricing.
 */
import type { ProxyCallRecord } from '../types.js';
export type CostCoverage = {
    pricedCalls: number;
    unpricedCalls: number;
    totalCalls: number;
    coveragePct: number;
    measuredUsd: number;
    disclaimer: string;
};
export type SpendMethod = 'measured' | 'repriced' | 'unavailable';
export declare function buildCostCoverage(records: ProxyCallRecord[]): CostCoverage;
/** Reprice records with tokens but zero costUsd using active model rates (display aggregation). */
export declare function repriceRecordsForDisplay(records: ProxyCallRecord[]): Promise<{
    records: ProxyCallRecord[];
    repricedCount: number;
}>;
export declare function shouldShowCostHeadline(coverage: CostCoverage, thresholdPct?: number): boolean;
/** Allow repriced headlines only when explicitly opted in (env). */
export declare function allowRepricedCostHeadline(): boolean;
/**
 * Resolve spendMethod + whether Security Center may show a USD headline.
 * measured = stored costUsd on records; repriced = filled via model rates.
 */
export declare function resolveSpendHeadline(params: {
    coverageBeforeReprice: CostCoverage;
    coverageAfterReprice: CostCoverage;
    repricedCount: number;
    allowRepriced?: boolean;
}): {
    spendMethod: SpendMethod;
    showHeadline: boolean;
    headlineUsd: number | null;
};
//# sourceMappingURL=cost-coverage.d.ts.map
/**
 * Executive summary rollup for enterprise dashboard overview.
 */
import type { IDatabase } from '../database/database-interface.js';
import { type ChartMetaEnvelope } from './chart-meta.js';
export type KpiComparison = {
    deltaPct: number | null;
    deltaAbs: number;
    direction: 'up' | 'down' | 'flat';
};
export type ExecutiveSummary = {
    timestamp: string;
    windowDays: number;
    totalRequests: number;
    blockedRequests: number;
    passedRequests: number;
    passRatePct: number | null;
    blockRatePct: number | null;
    totalCostUsd: number;
    burnRatePerHour: number;
    projectedMonthlyUsd: number;
    avgLatencyMs: number;
    activeServers: number;
    budgetUsd: number | null;
    budgetUtilizationPct: number | null;
    runwayDays: number | null;
    topServersByCost: Array<{
        server: string;
        costUsd: number;
        calls: number;
    }>;
    topToolsByCalls: Array<{
        tool: string;
        calls: number;
    }>;
    meta: ChartMetaEnvelope;
    comparison?: {
        totalRequests: KpiComparison;
        blockedRequests: KpiComparison;
        totalCostUsd: KpiComparison;
        passRatePct: KpiComparison;
    };
    sparklines?: {
        totalCalls: number[];
        blocked: number[];
        costUsd: number[];
    };
};
export declare function buildExecutiveSummary(db: IDatabase, tenantId: string | undefined, windowDaysInput?: number): Promise<ExecutiveSummary>;
//# sourceMappingURL=dashboard-executive-summary.d.ts.map
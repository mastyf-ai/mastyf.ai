/**
 * Aggregated analytics for the MCP Mastyf AI Analytics dashboard (video Feature 1).
 */
import type { IDatabase } from '../database/database-interface.js';
import { type ChartMetaEnvelope } from './chart-meta.js';
export type AnalyticsTrafficPoint = {
    bucket: string;
    requests: number;
    blocked: number;
};
export type AnalyticsLatencyPoint = {
    bucket: string;
    p50Ms: number;
    p95Ms: number;
};
export type AnalyticsErrorRatePoint = {
    bucket: string;
    errorRatePct: number;
    blocked: number;
    requests: number;
};
export type AnalyticsCostPoint = {
    bucket: string;
    costUsd: number;
    label: string;
};
export type AnalyticsModelUsage = {
    model: string;
    label: string;
    calls: number;
    tokens: number;
    pct: number;
};
export type AnalyticsProviderCost = {
    provider: string;
    label: string;
    costUsd: number;
    colorKey: 'openai' | 'anthropic' | 'google' | 'other';
};
export type AnalyticsSummary = {
    available: boolean;
    windowDays: number;
    generatedAt: string;
    totalRequests: number;
    avgLatencyMs: number;
    errorRatePct: number;
    tokensUsed: number;
    budgetUsd: number | null;
    budgetUtilizationPct: number | null;
    trafficSeries: AnalyticsTrafficPoint[];
    latencySeries: AnalyticsLatencyPoint[];
    errorRateSeries: AnalyticsErrorRatePoint[];
    costSeries: AnalyticsCostPoint[];
    modelUsage: AnalyticsModelUsage[];
    providerCosts: AnalyticsProviderCost[];
    meta: ChartMetaEnvelope;
    emptyReason?: string;
};
export declare function buildAnalyticsSummary(db: IDatabase | null, tenantId: string | undefined, windowDaysInput: number | string): Promise<AnalyticsSummary>;
//# sourceMappingURL=analytics-summary.d.ts.map
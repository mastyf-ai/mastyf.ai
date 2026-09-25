/**
 * Cost time-series aggregation for dashboard charts.
 */
import type { IDatabase } from '../database/database-interface.js';
import type { ProxyCallRecord } from '../types.js';
import { type ChartMetaEnvelope } from './chart-meta.js';
export type CostGranularity = 'hour' | 'day';
export type CostTimeseriesPoint = {
    bucket: string;
    server: string;
    costUsd: number;
    calls: number;
};
export type CostTimeseriesResult = {
    windowDays: number;
    granularity: CostGranularity;
    series: CostTimeseriesPoint[];
    totalsByServer: Array<{
        server: string;
        costUsd: number;
        calls: number;
    }>;
    pivoted: Array<{
        bucket: string;
        total: number;
        [server: string]: string | number;
    }>;
    meta: ChartMetaEnvelope;
    comparison?: {
        totalCostUsd: {
            deltaPct: number | null;
            deltaAbs: number;
            direction: 'up' | 'down' | 'flat';
        };
    };
};
export declare function buildCostTimeseries(db: IDatabase, tenantId: string | undefined, windowDaysInput: number, granularityInput?: CostGranularity): Promise<CostTimeseriesResult>;
/** Pivot series into stacked chart rows keyed by bucket with top-N + Other. */
export declare function pivotCostTimeseries(series: CostTimeseriesPoint[], topServers?: Set<string>, buckets?: string[]): Array<{
    bucket: string;
    total: number;
    [server: string]: string | number;
}>;
export declare function loadAllRecordsInWindow(db: IDatabase, tenantId: string | undefined, windowDays: number): Promise<ProxyCallRecord[]>;
//# sourceMappingURL=cost-timeseries.d.ts.map
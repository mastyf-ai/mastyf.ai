/**
 * Standard metadata envelope for dashboard chart APIs.
 */
import { type DashboardWindow } from './time-buckets.js';
export type ChartMetaEnvelope = {
    window: DashboardWindow;
    windowDays: number;
    generatedAt: string;
    recordCount: number;
    sparse?: boolean;
    dataSources: string[];
    emptyReason?: string;
};
export declare function buildChartMeta(opts: {
    windowDays: number;
    recordCount: number;
    sparse?: boolean;
    dataSources: string[];
    emptyReason?: string;
    generatedAt?: string;
}): ChartMetaEnvelope;
//# sourceMappingURL=chart-meta.d.ts.map
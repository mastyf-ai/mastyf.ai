/**
 * Audit block heatmap aggregation (rule × tool + day × hour activity matrix).
 */
import type { ProxyCallRecord } from '../types.js';
import { type ChartMetaEnvelope } from './chart-meta.js';
export type AuditHeatmapCell = {
    rule: string;
    tool: string;
    count: number;
};
export type AuditActivityMatrix = {
    days: string[];
    hours: number[];
    matrix: number[][];
    maxCount: number;
};
export type AuditHeatmapResult = {
    windowDays: number;
    cells: AuditHeatmapCell[];
    activity: AuditActivityMatrix;
    meta: ChartMetaEnvelope;
};
export declare function buildAuditHeatmap(records: ProxyCallRecord[], maxCells?: number): AuditHeatmapCell[];
export declare function buildAuditActivityMatrix(records: ProxyCallRecord[]): AuditActivityMatrix;
export declare function buildAuditHeatmapBundle(records: ProxyCallRecord[], windowDaysInput?: number): AuditHeatmapResult;
//# sourceMappingURL=audit-heatmap.d.ts.map
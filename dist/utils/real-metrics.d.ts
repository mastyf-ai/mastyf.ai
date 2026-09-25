import type { PerformanceBaseline } from '../agentic/drift/drift-detector.js';
import type { ProxyCallRecord } from '../types.js';
export type ObservedTool = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
};
export declare function parseMastyfTimestamp(ts: string): number;
export declare function filterRecordsByWindow(records: ProxyCallRecord[], windowDays: number, nowMs?: number): ProxyCallRecord[];
export declare function percentile(values: number[], pct: number): number;
export declare function computeMeasuredPerformance(records: ProxyCallRecord[]): PerformanceBaseline | null;
export declare function buildObservedTools(records: ProxyCallRecord[]): ObservedTool[];
//# sourceMappingURL=real-metrics.d.ts.map
/**
 * Aggregate proxy call metrics from local history.db for cloud fleet heartbeat.
 */
import type { HeartbeatMetrics } from '../control-plane/instance-registry.js';
import { summarizeRecords } from './db-aggregate.js';
export declare function collectProxyHeartbeatMetrics(): Promise<Partial<HeartbeatMetrics>>;
/** @deprecated use collectProxyHeartbeatMetrics */
export declare function aggregateCallRecordsFromDb(summary: {
    total: number;
    blocked: number;
    cost: number;
}, rules: Array<{
    rule: string;
    cnt: number;
}>): {
    totalRequests: number;
    blockedRequests: number;
    totalCostUsd: number;
    topBlockRules: {
        rule: string;
        count: number;
    }[];
};
export { summarizeRecords };
//# sourceMappingURL=heartbeat-proxy-metrics.d.ts.map
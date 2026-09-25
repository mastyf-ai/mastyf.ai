/**
 * Read-only PostgreSQL reader for unified_audit_trail / fleet tables.
 * Used by dashboard when proxies sync SQLite → shared Postgres.
 */
import { type PgPoolType } from '../database/pg-loader.js';
import type { ProxyCallRecord } from '../types.js';
import type { FleetInstanceRow } from '../fleet/fleet-aggregator.js';
export type AuditEvent = {
    timestamp: string;
    server_name: string;
    tool_name: string;
    action: string;
    rule?: string;
    reason?: string;
    request_tokens: number;
    response_tokens: number;
    total_tokens: number;
    duration_ms: number;
    instance_id?: string;
};
export type HourlyBucket = {
    bucket: string;
    total: number;
    blocked: number;
    costUsd: number;
};
export type CostTimeseriesPoint = {
    bucket: string;
    server: string;
    costUsd: number;
    calls: number;
};
export declare function initUnifiedDataReaderPool(databaseUrl?: string): Promise<PgPoolType | null>;
export declare function getUnifiedDataReaderPool(): PgPoolType | null;
export declare function closeUnifiedDataReaderPool(): Promise<void>;
export declare class UnifiedDataReader {
    private pool;
    constructor(pool: PgPoolType);
    loadCallRecordsInWindow(tenantId: string | undefined, windowDaysInput: number, region?: string): Promise<ProxyCallRecord[]>;
    aggregateHourlyTraffic(tenantId: string | undefined, windowDaysInput: number, region?: string): Promise<HourlyBucket[]>;
    aggregateCostTimeseries(tenantId: string | undefined, windowDaysInput: number, granularity: 'hour' | 'day', region?: string): Promise<CostTimeseriesPoint[]>;
    queryAuditEvents(tenantId: string | undefined, opts: {
        limit?: number;
        action?: string;
        server?: string;
        region?: string;
    }): Promise<AuditEvent[]>;
    getFleetInstancesFromPg(): Promise<FleetInstanceRow[]>;
    listRegions(): Promise<string[]>;
}
//# sourceMappingURL=unified-data-reader.d.ts.map
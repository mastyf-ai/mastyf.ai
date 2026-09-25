/**
 * Shared aggregation helpers for TUI, dashboard, and APIs reading history.db.
 */
import type { IDatabase } from '../database/database-interface.js';
import type { ProxyCallRecord } from '../types.js';
import type { SecurityReport } from '../types.js';
export declare function getAllActiveServerNames(db: IDatabase, tenantId?: string): Promise<string[]>;
export declare function parseSecurityScanDetails(scan: unknown): SecurityReport | null;
export declare function summarizeRecords(records: ProxyCallRecord[]): {
    total: number;
    blocked: number;
    passed: number;
    totalInput: number;
    totalOutput: number;
    totalLatency: number;
    costUsd: number;
    pricedCalls: number;
    unpricedCalls: number;
    models: string[];
};
export declare function loadAllCallRecords(db: IDatabase, servers: string[], tenantId?: string): Promise<ProxyCallRecord[]>;
/** Per-MCP-server row for TUI Instances tab (not a single Mastyf AI process). */
export interface ServerInstanceRow {
    instanceId: string;
    instanceName: string;
    status: 'active' | 'degraded' | 'offline';
    hostname: string;
    version: string;
    lastHeartbeat: string;
    totalRequests: number;
    blockedRequests: number;
    totalCostUsd: number;
    avgLatencyMs: number;
}
export declare function aggregateInstancesByServer(records: ProxyCallRecord[], serverNames: string[], nowMs?: number): ServerInstanceRow[];
export declare function cveCountFromScanRow(scan: Record<string, unknown>): number;
export declare function securityRowFromScan(scan: Record<string, unknown>, fallbackName: string): {
    name: string;
    score: number;
    cves: number;
    critical: number;
    high: number;
    auth: boolean;
};
//# sourceMappingURL=db-aggregate.d.ts.map
/**
 * Abstracted database interface for Mastyf AI.
 * Supports SQLite (local/file) and PostgreSQL (cloud/horizontal scaling).
 */
import { ProxyCallRecord } from '../types.js';
export interface IDatabase {
    initialize(): Promise<void>;
    /** Returns null when no health data exists — no fabricated default. */
    getRecentSuccessRate(serverName: string, tenantId?: string): Promise<number | null>;
    addSecurityScan(serverName: string, score: number, cveCount: number, details: unknown, tenantId?: string): Promise<void>;
    getLatestSecurityScan(serverName: string, tenantId?: string): Promise<unknown | null>;
    getDistinctScannedServers(tenantId?: string): Promise<string[]>;
    /** Union of servers seen in security_scans and call_records (for TUI/dashboard). */
    getDistinctActiveServers(tenantId?: string): Promise<string[]>;
    addCostRecord(serverName: string, tokens: number, cost: number, tenantId?: string): Promise<void>;
    getTotalCost?(serverName?: string, tenantId?: string): Promise<number | null>;
    getLatestHealthCheck?(serverName: string, tenantId?: string): Promise<{
        latency_ms?: number;
        tool_count?: number;
    } | null>;
    addHealthCheck(serverName: string, latency: number, success: boolean, toolCount: number, tenantId?: string): Promise<void>;
    addCallRecord(record: ProxyCallRecord): Promise<void>;
    getCallRecordsForServer(serverName: string, limit?: number, tenantId?: string): Promise<ProxyCallRecord[]>;
    /**
     * SQLite: callback must be synchronous (no Promise return).
     * PostgreSQL: callback may be async.
     */
    transaction<T>(fn: () => Promise<T> | T): Promise<T>;
    /** Synchronous transaction (SQLite / better-sqlite3). */
    transactionSync?<T>(fn: () => T): Promise<T>;
    flush(): void | Promise<void>;
    close(): void | Promise<void>;
}
//# sourceMappingURL=database-interface.d.ts.map
/**
 * MCP Mastyf AI History Database — better-sqlite3 with WAL mode.
 *
 * Replaces the original sql.js (WASM/in-memory) implementation with a
 * synchronous, disk-backed, WAL-mode SQLite database that survives crashes,
 * supports concurrent reads during writes, and has zero in-memory overhead.
 *
 * Fix 1 from the Production Readiness Audit (Part 7 — Remediation Blueprint).
 * v2.3.24: Replaced proper-lockfile with simple PID-based lock to eliminate stale lock issues.
 *
 * Secondary writers: set `MASTYF_AI_DB_PATH` to the same file on the host;
 * WAL mode + busy_timeout=5000 allow concurrent proxy/TUI access.
 */
import Database from 'better-sqlite3';
import { ProxyCallRecord } from '../types.js';
import { IDatabase } from './database-interface.js';
/** Configurable audit retention (default 30 days). */
export declare function resolveRetentionDays(): number;
export interface SecurityRecord {
    id: number;
    server_name: string;
    score: number;
    cves_found: number;
    details: string;
    created_at: string;
}
export interface CostRecord {
    id: number;
    server_name: string;
    tokens_used: number;
    estimated_cost_usd: number;
    tokenizer_provider?: string;
    is_estimate?: number;
    created_at: string;
}
export interface HealthRecord {
    id: number;
    server_name: string;
    latency_ms: number;
    success: number;
    tool_count: number;
    created_at: string;
}
/**
 * Simple PID-based file lock — replaces proper-lockfile.
 * Writes PID to a .pid file. On construction, checks if another process
 * holds the lock (via kill(pid, 0)). If stale, cleans up and re-acquires.
 */
export interface HistoryDatabaseOptions {
    /** Share the canonical DB read-only while another process holds the write lock (TUI, doctor). */
    readOnly?: boolean;
}
export declare class HistoryDatabase implements IDatabase {
    private db;
    private dbPath;
    private readonly openedReadOnly;
    private lockCleanup;
    private PURGE_TTL_DAYS;
    private purgeInterval;
    constructor(dbPathOrMemory?: string, options?: HistoryDatabaseOptions);
    initialize(): Promise<void>;
    getDbPath(): string;
    isReadOnly(): boolean;
    /** Synchronous SQL exec — used by IndustryStandardStore migrations and CRUD. */
    exec(sql: string): void;
    /** Prepared statement — delegates to better-sqlite3 for IndustryStandardStore. */
    prepare(sql: string): ReturnType<Database.Database['prepare']>;
    /** SQLCipher PRAGMA key when MASTYF_AI_DB_ENCRYPTION_KEY is set (requires sqlcipher-enabled build). */
    private applySqlCipherKeyIfConfigured;
    private migrate;
    private migrateQueryIndexes;
    private migrateTenantAuditColumns;
    private migrateCallRecordsColumns;
    addCallRecord(record: ProxyCallRecord): Promise<void>;
    getCallRecordsForServer(serverName: string, limit?: number, tenantId?: string): Promise<ProxyCallRecord[]>;
    /** Incremental sync — rows with id > afterId in ascending order. */
    getCallRecordsAfterId(serverName: string, afterId: number, limit: number, tenantId?: string): Promise<Array<ProxyCallRecord & {
        sourceId: number;
    }>>;
    private mapCallRecordRow;
    transactionSync<T>(fn: () => T): Promise<T>;
    transaction<T>(fn: () => Promise<T> | T): Promise<T>;
    flush(): Promise<void>;
    addSecurityScan(serverName: string, score: number, cvesFound: number, details: unknown, tenantId?: string): Promise<void>;
    getLatestSecurityScan(serverName: string, tenantId?: string): Promise<SecurityRecord | null>;
    getSecurityScanHistory(serverName: string, limit?: number, tenantId?: string): Promise<SecurityRecord[]>;
    getDistinctScannedServers(tenantId?: string): Promise<string[]>;
    getDistinctActiveServers(tenantId?: string): Promise<string[]>;
    addCostRecord(serverName: string, tokensUsed: number, estimatedCostUSD: number, tenantId?: string): Promise<void>;
    getLatestCostRecord(serverName: string, tenantId?: string): Promise<CostRecord | null>;
    getCostHistory(serverName: string, tenantId?: string): Promise<CostRecord[]>;
    getTotalCost(serverName?: string, tenantId?: string): Promise<number | null>;
    addHealthCheck(serverName: string, latencyMs: number, success: boolean, toolCount: number, tenantId?: string): Promise<void>;
    getLatestHealthCheck(serverName: string, tenantId?: string): Promise<HealthRecord | null>;
    getRecentSuccessRate(serverName: string, tenantId?: string): Promise<number | null>;
    /** Distinct tenant ids present in audit tables (for PG sync). */
    getDistinctAuditTenants(): string[];
    /** Distinct server names for a tenant across audit tables. */
    getDistinctServersForTenant(tenantId: string): string[];
    private startPurgeInterval;
    purge(ttlDays?: number): void;
    /**
     * GDPR Article 17 — erase audit data in this database file.
     * When tenantId is provided, only that tenant's rows are removed.
     */
    eraseAllAuditData(tenantId?: string): {
        callRecords: number;
        costRecords: number;
        securityScans: number;
        healthChecks: number;
    };
    close(): void;
}
//# sourceMappingURL=history-db.d.ts.map
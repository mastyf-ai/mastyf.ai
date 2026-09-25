/**
 * PostgreSQL implementation of IDatabase for horizontal scaling.
 * Uses connection pool for production workloads.
 * Enable with: DB_TYPE=postgres DATABASE_URL=postgresql://user:pass@host:5432/db
 */
import { ProxyCallRecord } from '../types.js';
import { IDatabase } from './database-interface.js';
export declare class PostgresDatabase implements IDatabase {
    private pool;
    private initialized;
    private connectionString;
    constructor();
    /** Run query under Postgres RLS session when enabled and tenantId is set. */
    private tenantQuery;
    initialize(): Promise<void>;
    getRecentSuccessRate(serverName: string, tenantId?: string): Promise<number | null>;
    addSecurityScan(serverName: string, score: number, cveCount: number, details: unknown, tenantId?: string): Promise<void>;
    getLatestSecurityScan(serverName: string, tenantId?: string): Promise<unknown | null>;
    getDistinctScannedServers(tenantId?: string): Promise<string[]>;
    getDistinctActiveServers(tenantId?: string): Promise<string[]>;
    addCostRecord(serverName: string, tokens: number, cost: number, tenantId?: string): Promise<void>;
    addHealthCheck(serverName: string, latency: number, success: boolean, toolCount: number, tenantId?: string): Promise<void>;
    addCallRecord(record: ProxyCallRecord): Promise<void>;
    getCallRecordsForServer(serverName: string, _limit?: number, tenantId?: string): Promise<ProxyCallRecord[]>;
    transaction<T>(fn: () => Promise<T> | T): Promise<T>;
    /** @deprecated Use transaction(fn: () => Promise<T>) — pool client is internal. */
    withTransactionClient<T>(fn: (client: any) => Promise<T>): Promise<T>;
    flush(): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=postgres-db.d.ts.map
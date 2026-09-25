/**
 * Minimal IDatabase adapter backed by in-memory call records (federated reads).
 */
import type { IDatabase } from '../database/database-interface.js';
import type { ProxyCallRecord } from '../types.js';
export declare class CallRecordsDbAdapter implements IDatabase {
    private records;
    constructor(records: ProxyCallRecord[]);
    initialize(): Promise<void>;
    getRecentSuccessRate(): Promise<number | null>;
    addSecurityScan(): Promise<void>;
    getLatestSecurityScan(): Promise<unknown | null>;
    getDistinctScannedServers(tenantId?: string): Promise<string[]>;
    getDistinctActiveServers(tenantId?: string): Promise<string[]>;
    private distinctServers;
    addCostRecord(): Promise<void>;
    addHealthCheck(): Promise<void>;
    addCallRecord(): Promise<void>;
    getCallRecordsForServer(serverName: string, limit?: number, tenantId?: string): Promise<ProxyCallRecord[]>;
    transactionSync<T>(fn: () => T): Promise<T>;
    transaction<T>(fn: () => Promise<T> | T): Promise<T>;
    flush(): void;
    close(): Promise<void>;
}
//# sourceMappingURL=call-records-db-adapter.d.ts.map
/**
 * Async audit write queue — decouples SQLite writes from the JSON-RPC hot path.
 * Single-writer discipline: one consumer drains batches via setImmediate.
 */
import type { IDatabase } from './database-interface.js';
import type { ProxyCallRecord } from '../types.js';
export interface AuditWriteJob {
    record: ProxyCallRecord;
    costRecord?: {
        serverName: string;
        tokens: number;
        costUsd: number;
        tenantId: string;
    };
}
export declare function getAuditQueueDepth(): number;
export declare function getAuditDroppedWrites(): number;
export declare function initAuditWriteQueue(database: IDatabase): void;
export declare function enqueueAuditWrite(job: AuditWriteJob): boolean;
export declare function flushAuditWriteQueue(): Promise<void>;
/** Reset for tests. */
export declare function resetAuditWriteQueueForTests(): void;
//# sourceMappingURL=audit-write-queue.d.ts.map
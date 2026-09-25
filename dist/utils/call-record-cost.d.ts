import type { IDatabase } from '../database/database-interface.js';
import type { ProxyCallRecord } from '../types.js';
/** Trim oversized audit fields before queue/DB write (L-2). */
export declare function compactCallRecordForPersistence(record: ProxyCallRecord): ProxyCallRecord;
export declare function commitSpendFromRecord(record: ProxyCallRecord): Promise<void>;
export declare function releaseSpendReservation(reservationId?: string): Promise<void>;
export declare function enrichCallRecord(record: ProxyCallRecord, msg?: unknown, serverEnv?: Record<string, string>, serverArgs?: string[]): Promise<ProxyCallRecord>;
export declare function persistCallRecord(db: IDatabase, record: ProxyCallRecord, msg?: unknown, serverEnv?: Record<string, string>, serverArgs?: string[]): Promise<ProxyCallRecord>;
//# sourceMappingURL=call-record-cost.d.ts.map
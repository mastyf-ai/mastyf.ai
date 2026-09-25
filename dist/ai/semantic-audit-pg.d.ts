/**
 * PostgreSQL persistence for semantic audit outcomes (enterprise / DATABASE_URL).
 * JSONL in semantic-audit-store.ts is used when PostgreSQL is not configured.
 */
import type { StoredSemanticAudit } from './semantic-audit-store.js';
export declare function isSemanticAuditPostgresEnabled(): boolean;
export declare function pgAppendSemanticAuditRecord(record: Omit<StoredSemanticAudit, 'id' | 'tenantId'> & {
    id?: string;
}): Promise<string | null>;
export declare function pgLoadSemanticAuditRecords(opts?: {
    tenantId?: string;
    sinceMs?: number;
    limit?: number;
}): Promise<StoredSemanticAudit[]>;
export declare function pgLabelSemanticAuditRecord(id: string, label: 'true_positive' | 'false_positive' | 'ignored', userId: string, tenantId?: string): Promise<boolean>;
/** @internal test reset */
export declare function resetSemanticAuditPgForTests(): void;
//# sourceMappingURL=semantic-audit-pg.d.ts.map
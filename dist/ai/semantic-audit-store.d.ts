import type { SemanticAuditResult } from './async-semantic-audit.js';
import type { PolicyDecision } from '../policy/policy-types.js';
export interface StoredSemanticAudit {
    id: string;
    tenantId: string;
    requestId: string | number;
    serverName: string;
    toolName: string;
    syncDecision: PolicyDecision;
    semanticAudit: SemanticAuditResult;
    model?: string;
    durationMs?: number;
    timestamp: string;
    labeled?: boolean;
    label?: 'true_positive' | 'false_positive' | 'ignored';
    labelUserId?: string;
    labelAt?: string;
    /** Redacted tool arguments for counterfactual replay (no secrets). */
    argumentsSnapshot?: Record<string, unknown>;
}
/** Shared dashboard / investigator lookup window (matches /api/learning/semantic/outcomes). */
export declare const SEMANTIC_AUDIT_DASHBOARD_WINDOW_MS: number;
export declare function normalizeSemanticAuditTriggerId(triggerId: string): string;
export declare function findSemanticAuditRecord(records: StoredSemanticAudit[], triggerId: string): StoredSemanticAudit | undefined;
/** Load records for a tenant, falling back to default tenant when the scoped store is empty. */
export declare function loadSemanticAuditRecordsWithTenantFallback(opts?: {
    tenantId?: string;
    sinceMs?: number;
    limit?: number;
}): Promise<{
    records: StoredSemanticAudit[];
    resolvedTenantId: string;
}>;
export declare function appendSemanticAuditRecord(record: Omit<StoredSemanticAudit, 'id' | 'tenantId'>): StoredSemanticAudit;
export declare function seedSemanticAuditFromBlocks(entries: Array<{
    tool: string;
    args: string;
    category: string;
    description: string;
    expected_action: string;
}>): number;
/** Merge Postgres + JSONL (dedupe by id; Postgres wins). */
export declare function loadSemanticAuditRecordsAsync(opts?: {
    tenantId?: string;
    sinceMs?: number;
    limit?: number;
}): Promise<StoredSemanticAudit[]>;
/** Sync load — JSONL only (tests / local scripts without async). */
export declare function loadSemanticAuditRecords(opts?: {
    tenantId?: string;
    sinceMs?: number;
    limit?: number;
}): StoredSemanticAudit[];
export declare function labelSemanticAuditRecord(id: string, label: 'true_positive' | 'false_positive' | 'ignored', userId: string, tenantId?: string): Promise<boolean>;
//# sourceMappingURL=semantic-audit-store.d.ts.map
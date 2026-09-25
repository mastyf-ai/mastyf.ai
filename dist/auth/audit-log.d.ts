import type { AuditLogEntry, AuditResult } from './rbac-types.js';
export interface WriteAuditLogInput {
    tenantId?: string;
    userId?: string | null;
    username?: string | null;
    action: string;
    result: AuditResult;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
}
export declare const auditLog: {
    write(input: WriteAuditLogInput): Promise<void>;
    query(params: {
        tenantId?: string;
        userId?: string;
        action?: string;
        result?: AuditResult;
        since?: string;
        until?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        entries: AuditLogEntry[];
        total: number;
    }>;
};
//# sourceMappingURL=audit-log.d.ts.map
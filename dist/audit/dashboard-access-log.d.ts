export interface DashboardAccessEntry {
    timestamp: string;
    userId: string;
    tenantId: string;
    method: string;
    /** API path (SOC2 / ISO 27001 access audit). */
    path: string;
    /** Alias for `path` — compliance exports expect `endpoint`. */
    endpoint: string;
    status: number;
    ip: string;
}
export interface SessionRotateEntry {
    timestamp: string;
    event: 'session_rotate';
    tenantId: string;
    oldTokenPrefix: string;
    newTokenPrefix: string;
}
export declare function appendDashboardAccessLog(entry: Omit<DashboardAccessEntry, 'timestamp' | 'endpoint'> & {
    endpoint?: string;
}): void;
export declare function appendSessionRotateAudit(entry: {
    tenantId: string;
    oldToken: string;
    newToken: string;
}): void;
export declare function readDashboardAccessLog(tenantId: string, limit?: number): DashboardAccessEntry[];
export declare function readTenantAuditJsonl(tenantId: string, fileName: 'policy-audit.jsonl' | 'dashboard-access.jsonl' | 'session-audit.jsonl', opts?: {
    startTime?: string;
    endTime?: string;
    limit?: number;
}): unknown[];
//# sourceMappingURL=dashboard-access-log.d.ts.map
export interface AuditRecord {
    recordId: string;
    timestamp: string;
    sessionId: string;
    method: string;
    toolName?: string;
    /** Arguments with values redacted (only keys + type info) */
    argsSummary: string;
    userId?: string;
    userTier?: string;
    latencyMs: number;
    blocked: boolean;
    blockReason?: string;
    responseSize: number;
    statusCode: string;
}
export declare class RequestAuditor {
    private records;
    private readonly maxRecords;
    constructor(maxRecords?: number);
    record(params: {
        sessionId: string;
        method: string;
        toolName?: string;
        args?: Record<string, unknown>;
        userId?: string;
        userTier?: string;
        latencyMs: number;
        blocked: boolean;
        blockReason?: string;
        responseSize: number;
        statusCode: string;
    }): AuditRecord;
    /** Redact argument values — only keep keys and types. */
    private redactArgs;
    /** Get recent audit records. */
    getRecords(limit?: number): AuditRecord[];
    /** Get records filtered by method. */
    getRecordsByMethod(method: string, limit?: number): AuditRecord[];
    /** Get records filtered by session. */
    getRecordsBySession(sessionId: string, limit?: number): AuditRecord[];
    /** Get audit statistics. */
    getStats(): {
        totalRecords: number;
        totalBlocked: number;
        totalAllowed: number;
        averageLatencyMs: number;
    };
}
//# sourceMappingURL=request-auditor.d.ts.map
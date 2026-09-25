export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';
export type LogCategory = 'user_activity' | 'security' | 'deployment' | 'system' | 'error' | 'warning' | 'debug' | 'swarm' | 'api_request' | 'policy_decision' | 'auth' | 'plugin';
export interface LogEntry {
    id: string;
    timestamp: string;
    level: LogLevel;
    category: LogCategory;
    message: string;
    source?: string;
    details?: string;
    metadata?: Record<string, unknown>;
}
export declare function writeLogEntry(tenantId: string, level: LogLevel, category: LogCategory, message: string, opts?: {
    source?: string;
    details?: string;
    metadata?: Record<string, unknown>;
}): LogEntry;
export declare function writeLogEntries(tenantId: string, entries: LogEntry[]): void;
export declare function loadLogEntries(tenantId: string, options: {
    search?: string;
    category?: string;
    level?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
}): {
    entries: LogEntry[];
    total: number;
};
export declare function getRecentLogEntries(tenantId: string, maxCount?: number): LogEntry[];
export declare function clearLogFiles(tenantId: string, category?: string): void;
export interface RetentionConfig {
    retentionDays: number;
    maxStorageMb: number;
    enabledCategories: LogCategory[];
}
export declare function setRetentionConfig(tenantId: string, cfg: Partial<RetentionConfig>): RetentionConfig;
export declare function enforceRetention(tenantId: string): {
    deletedFiles: number;
};
export declare function startRetentionScheduler(tenantId: string, intervalMs?: number): void;
export declare function stopRetentionScheduler(): void;
//# sourceMappingURL=dashboard-log-writer.d.ts.map
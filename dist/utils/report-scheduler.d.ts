export declare function generateDigest(historyDb: unknown, tenantId?: string, windowDays?: number): Promise<{
    healthPath?: string;
    securityPath?: string;
    error?: string;
}>;
export declare function getLatestDigestPaths(tenantId?: string): {
    healthPath?: string;
    securityPath?: string;
    generatedAt?: string;
};
export declare function tickReportScheduler(historyDb: unknown, tenantId?: string): Promise<void>;
export declare function startReportScheduler(historyDb: unknown, tenantId?: string): void;
export declare function stopReportScheduler(): void;
/** Read latest digest files for API (newest by date prefix in dir). */
export declare function readLatestDigestArtifacts(tenantId?: string): {
    healthMarkdown?: string;
    securityJson?: Record<string, unknown>;
    generatedAt?: string;
};
//# sourceMappingURL=report-scheduler.d.ts.map
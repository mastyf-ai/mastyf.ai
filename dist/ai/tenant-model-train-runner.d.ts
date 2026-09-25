export type TenantTrainJobStatus = {
    jobId: string;
    tenantId: string;
    state: 'idle' | 'running' | 'done' | 'failed';
    startedAt: string | null;
    finishedAt: string | null;
    exitCode: number | null;
    error: string | null;
    logTail: string;
};
export declare function isTenantTrainJobRunning(tenantId: string): boolean;
export declare function getTenantTrainJobStatus(tenantId: string): TenantTrainJobStatus;
export declare function startTenantTrainJob(tenantId: string): {
    ok: boolean;
    jobId?: string;
    error?: string;
    status?: number;
};
//# sourceMappingURL=tenant-model-train-runner.d.ts.map
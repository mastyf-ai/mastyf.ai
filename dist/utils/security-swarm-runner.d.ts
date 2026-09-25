export interface SwarmJobStatus {
    jobId: string;
    tenantId: string;
    state: 'idle' | 'running' | 'done' | 'failed';
    phase: string;
    phaseLabel: string;
    progressPct: number;
    startedAt: string | null;
    finishedAt: string | null;
    exitCode: number | null;
    error: string | null;
    analysisPath: string;
    logTail: string;
    pid?: number | null;
    hasRun?: boolean;
    sessionArtifactsVisible?: boolean;
}
/**
 * Detect orphaned jobs (process died without updating job.json) and mark them failed
 * so the dashboard can start a new run.
 */
export declare function reconcileStaleSwarmJob(tenantId?: string): boolean;
export declare function getSwarmJobStatus(tenantId?: string): SwarmJobStatus;
export declare function isSwarmJobRunning(tenantId?: string): boolean;
export declare function startSwarmJobWatcher(tenantId?: string): void;
export declare function stopSwarmJobWatcher(): void;
export declare function startSwarmAnalysis(opts?: {
    full?: boolean;
    tenantId?: string;
}): {
    ok: boolean;
    jobId?: string;
    startedAt?: string;
    error?: string;
    status?: number;
    tenantId?: string;
};
export declare function readAnalysisReport(tenantId?: string): {
    ok: boolean;
    text?: string;
    error?: string;
};
export { REPO_ROOT, SWARM_DIR, readSwarmLatest, readSwarmSummaryMd, listSwarmFigures, readSwarmFigure, readPlainEnglishReport, readTrafficSummary, readUserServersSession, } from './swarm-artifacts.js';
//# sourceMappingURL=security-swarm-runner.d.ts.map
import type { TribunalReport } from '../ai/swarm-debate-tribunal.js';
export interface TribunalJobStatus {
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
    logTail: string;
    pid: number | null;
    debatedCount?: number;
    remainingEligible?: number;
}
export declare function loadTribunalReport(tenantId?: string): TribunalReport | null;
export declare function getTribunalJobStatus(tenantId?: string): TribunalJobStatus;
export declare function isTribunalJobRunning(tenantId?: string): boolean;
export declare function startTribunalJob(tenantId?: string, opts?: {
    limit?: number;
    useLlm?: boolean;
}): {
    ok: boolean;
    jobId?: string;
    startedAt?: string;
    error?: string;
    status?: number;
};
/** Test helper — reset watcher state. */
export declare function resetTribunalRunnerForTests(): void;
//# sourceMappingURL=tribunal-runner.d.ts.map
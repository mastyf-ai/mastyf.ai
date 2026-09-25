import { type ThreatDiscoveryJobKind } from './threat-discovery-job-file.js';
export type { ThreatDiscoveryJobKind };
export interface ThreatDiscoveryJobStatus {
    jobId: string;
    kind: ThreatDiscoveryJobKind;
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
}
/**
 * Mark orphaned discovery jobs failed/done when the child exited without updating job.json
 * (e.g. dashboard restart while a detached job was running).
 */
export declare function reconcileStaleThreatDiscoveryJob(tenantId: string, kind: ThreatDiscoveryJobKind): boolean;
export declare function getThreatDiscoveryJobStatus(tenantId: string | undefined, kind: ThreatDiscoveryJobKind): ThreatDiscoveryJobStatus;
export declare function isThreatDiscoveryJobRunning(tenantId: string, kind: ThreatDiscoveryJobKind): boolean;
export declare function resumeThreatDiscoveryWatchers(tenantId?: string): void;
declare function spawnDiscoveryJob(tenantId: string, kind: ThreatDiscoveryJobKind, extraEnv: Record<string, string>): {
    ok: boolean;
    jobId?: string;
    startedAt?: string;
    error?: string;
    status?: number;
};
export declare function startThreatLabJob(tenantId?: string, opts?: {
    mode?: 'reactive' | 'proactive';
}): ReturnType<typeof spawnDiscoveryJob>;
export declare function startAutoThreatResearchJob(tenantId?: string): ReturnType<typeof spawnDiscoveryJob>;
/** Test helper — reset watcher state. */
export declare function resetThreatDiscoveryRunnerForTests(): void;
//# sourceMappingURL=threat-discovery-runner.d.ts.map
/**
 * In-process Threat Discovery Auto-Scheduler.
 *
 * Replaces the previous no-op endpoints that just returned a static OK message.
 * The scheduler:
 *   - Persists state to `~/.mastyf-ai/scheduler-state.json` so the
 *     existing `/api/threat-discovery/scheduler/status` reader keeps working.
 *   - Runs Auto-Threat-Research on a configurable interval per tenant.
 *   - Survives proxy restarts when MASTYF_AI_THREAT_DISCOVERY_AUTOSTART=true
 *     by checking the persisted `running` flag on import.
 *
 * Environment:
 *   MASTYF_AI_THREAT_DISCOVERY_INTERVAL_MS  default 3_600_000 (1h)
 *   MASTYF_AI_THREAT_DISCOVERY_AUTOSTART    'true' to auto-start at proxy boot
 */
export interface SchedulerState {
    running: boolean;
    startedAt: string | null;
    stoppedAt: string | null;
    lastRunAt: string | null;
    lastRunStatus: 'success' | 'failed' | null;
    lastRunError: string | null;
    nextRunAt: string | null;
    intervalMs: number;
    totalRuns: number;
    totalErrors: number;
    tenantId: string;
    pid: number | null;
    message?: string;
}
export declare function startScheduler(tenantId: string): SchedulerState;
export declare function stopScheduler(): SchedulerState;
export declare function getSchedulerStatus(tenantId: string): SchedulerState;
/** Auto-start at proxy boot if env flag is set. Called from dashboard-server start path. */
export declare function maybeAutoStart(tenantId: string): void;
//# sourceMappingURL=threat-discovery-scheduler.d.ts.map
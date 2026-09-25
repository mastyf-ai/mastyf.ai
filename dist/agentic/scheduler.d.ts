/**
 * Agentic Scheduler — cron-like scheduler for autonomous background tasks.
 *
 * Supports:
 *   - Cron expressions via 'cron' package (or simple interval fallback)
 *   - Named, registered tasks with health reporting
 *   - Graceful shutdown
 *   - Concurrency limits per task type
 */
export interface ScheduledTask {
    /** Unique task id */
    id: string;
    /** Human-readable name */
    name: string;
    /** Cron expression or interval string */
    schedule: string;
    /** The function to execute */
    fn: () => Promise<void>;
    /** Whether the task is currently enabled */
    enabled: boolean;
    /** Last execution timestamp */
    lastRun?: string;
    /** Last execution duration in ms */
    lastDurationMs?: number;
    /** Whether the task is currently running */
    running: boolean;
}
export declare class AgenticScheduler {
    private tasks;
    private timers;
    private cronJobs;
    private running;
    private pruneInterval;
    /** Register a new scheduled task. */
    register(id: string, name: string, schedule: string, fn: () => Promise<void>): void;
    /** Parse a schedule string into milliseconds (supports simple interval strings like "5m", "1h", "24h") */
    private parseInterval;
    /** Start all registered, enabled tasks. */
    start(): void;
    private startTask;
    /** Enable (or re-enable) a specific task. */
    enable(id: string): boolean;
    /** Disable a specific task without unregistering it. */
    disable(id: string): boolean;
    /** Unregister a task completely. */
    unregister(id: string): boolean;
    /** Get status of all tasks. */
    getStatus(): ScheduledTask[];
    /** Get a specific task status. */
    getTask(id: string): ScheduledTask | undefined;
    /** Run a specific task immediately (outside of its schedule). */
    runNow(id: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /** Clean up expired internal state. */
    private prune;
    /** Graceful shutdown — stops all timers. */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=scheduler.d.ts.map
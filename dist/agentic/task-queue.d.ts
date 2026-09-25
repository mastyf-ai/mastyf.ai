/**
 * Agentic Task Queue — priority-based queue for agentic background work.
 *
 * Ensures agentic features (policy gen, red team, threat prediction) don't
 * overwhelm the system by enforcing:
 *   - Priority ordering (HIGH > MEDIUM > LOW)
 *   - Concurrency limits
 *   - Task deduplication
 *   - Timeout enforcement
 */
export type TaskPriority = 'high' | 'medium' | 'low';
export interface QueuedTask<T = unknown> {
    /** Unique task id */
    id: string;
    /** The feature/domain this task belongs to */
    domain: string;
    /** Human-readable name */
    name: string;
    /** Priority */
    priority: TaskPriority;
    /** The async function to execute */
    fn: () => Promise<T>;
    /** When the task was enqueued */
    enqueuedAt: string;
    /** Maximum execution time in ms (after which the task is aborted) */
    timeoutMs: number;
    /** Current status */
    status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout';
    /** Result (if completed) */
    result?: T;
    /** Error message (if failed) */
    error?: string;
}
export declare class AgenticTaskQueue {
    private queue;
    private processing;
    private concurrency;
    private activeCount;
    private running;
    private dedupKeys;
    constructor(concurrency?: number);
    /**
     * Enqueue a task for asynchronous execution.
     * Returns the task id.
     */
    enqueue<T = unknown>(domain: string, name: string, fn: () => Promise<T>, options?: {
        priority?: TaskPriority;
        timeoutMs?: number;
        dedupKey?: string;
    }): string;
    /** Start the queue processor. */
    start(): void;
    /** Get task by id. */
    getTask(id: string): QueuedTask | undefined;
    /** Get queue stats. */
    getStats(): {
        queued: number;
        running: number;
        completed: number;
        failed: number;
        total: number;
    };
    /** Process the queue — picks highest priority tasks and executes them. */
    private processQueue;
    /** Execute a single task with timeout enforcement. */
    private executeTask;
    /** Execute a promise with a timeout. */
    private withTimeout;
    private sleep;
    /** Graceful shutdown — wait for running tasks to complete. */
    shutdown(drainMs?: number): Promise<void>;
}
//# sourceMappingURL=task-queue.d.ts.map
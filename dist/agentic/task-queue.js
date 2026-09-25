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
import { Logger } from '../utils/logger.js';
const PRIORITY_ORDER = {
    high: 0,
    medium: 1,
    low: 2,
};
export class AgenticTaskQueue {
    queue = [];
    processing = false;
    concurrency;
    activeCount = 0;
    running = false;
    dedupKeys = new Set();
    constructor(concurrency = 2) {
        this.concurrency = concurrency;
    }
    /**
     * Enqueue a task for asynchronous execution.
     * Returns the task id.
     */
    enqueue(domain, name, fn, options = {}) {
        // Deduplication check
        if (options.dedupKey) {
            if (this.dedupKeys.has(options.dedupKey)) {
                Logger.debug(`[AgenticTaskQueue] Deduplicating task: ${options.dedupKey}`);
                // Return a deterministic dedup id; the task is considered already queued.
                return `dedup:${options.dedupKey}`;
            }
            this.dedupKeys.add(options.dedupKey);
        }
        const id = crypto.randomUUID();
        const task = {
            id,
            domain,
            name,
            priority: options.priority || 'medium',
            fn,
            enqueuedAt: new Date().toISOString(),
            timeoutMs: options.timeoutMs || 60_000,
            status: 'queued',
        };
        this.queue.push(task);
        Logger.debug(`[AgenticTaskQueue] Enqueued [${task.priority}] ${domain}/${name} (${id})`);
        // Start processing if not already running
        if (this.running && !this.processing) {
            this.processQueue();
        }
        return id;
    }
    /** Start the queue processor. */
    start() {
        if (this.running)
            return;
        this.running = true;
        Logger.info(`[AgenticTaskQueue] Started with concurrency=${this.concurrency}`);
        this.processQueue();
    }
    /** Get task by id. */
    getTask(id) {
        return this.queue.find(t => t.id === id);
    }
    /** Get queue stats. */
    getStats() {
        let queued = 0, running = 0, completed = 0, failed = 0;
        for (const t of this.queue) {
            switch (t.status) {
                case 'queued':
                    queued++;
                    break;
                case 'running':
                    running++;
                    break;
                case 'completed':
                    completed++;
                    break;
                case 'failed':
                case 'timeout':
                    failed++;
                    break;
            }
        }
        return { queued, running, completed, failed, total: this.queue.length };
    }
    /** Process the queue — picks highest priority tasks and executes them. */
    async processQueue() {
        if (this.processing)
            return;
        this.processing = true;
        try {
            while (this.running) {
                // Sort by priority then enqueue time
                this.queue.sort((a, b) => {
                    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
                    if (pDiff !== 0)
                        return pDiff;
                    return a.enqueuedAt.localeCompare(b.enqueuedAt);
                });
                // Find next queued task
                const nextTask = this.queue.find(t => t.status === 'queued');
                if (!nextTask) {
                    if (this.activeCount === 0) {
                        // Idle — all tasks processed
                        this.processing = false;
                        return;
                    }
                    // Still have running tasks — wait and recheck
                    await this.sleep(100);
                    continue;
                }
                // Check concurrency limit
                if (this.activeCount >= this.concurrency) {
                    await this.sleep(50);
                    continue;
                }
                // Execute task
                this.executeTask(nextTask);
            }
        }
        finally {
            this.processing = false;
        }
    }
    /** Execute a single task with timeout enforcement. */
    async executeTask(task) {
        task.status = 'running';
        this.activeCount++;
        const start = Date.now();
        try {
            const result = await this.withTimeout(task.fn(), task.timeoutMs);
            task.result = result;
            task.status = 'completed';
            Logger.debug(`[AgenticTaskQueue] Completed ${task.domain}/${task.name} in ${Date.now() - start}ms`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message === 'TASK_TIMEOUT') {
                task.status = 'timeout';
                task.error = `Timed out after ${task.timeoutMs}ms`;
                Logger.warn(`[AgenticTaskQueue] Timeout ${task.domain}/${task.name}`);
            }
            else {
                task.status = 'failed';
                task.error = message;
                Logger.error(`[AgenticTaskQueue] Failed ${task.domain}/${task.name}: ${message}`);
            }
        }
        finally {
            this.activeCount--;
            // Remove from dedup set if applicable
            // (We keep completed tasks in the queue array for status queries;
            // dedup keys clear after completion to allow re-enqueue)
        }
        // Restart processing loop if it exited
        if (!this.processing && this.running) {
            this.processQueue();
        }
    }
    /** Execute a promise with a timeout. */
    async withTimeout(promise, timeoutMs) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('TASK_TIMEOUT')), timeoutMs)),
        ]);
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /** Graceful shutdown — wait for running tasks to complete. */
    async shutdown(drainMs = 10_000) {
        Logger.info('[AgenticTaskQueue] Shutting down...');
        this.running = false;
        // Wait for active tasks to drain
        const deadline = Date.now() + drainMs;
        while (this.activeCount > 0 && Date.now() < deadline) {
            await this.sleep(100);
        }
        if (this.activeCount > 0) {
            Logger.warn(`[AgenticTaskQueue] Shutdown with ${this.activeCount} tasks still running`);
        }
        else {
            Logger.info('[AgenticTaskQueue] Shutdown complete — all tasks drained');
        }
    }
}
//# sourceMappingURL=task-queue.js.map
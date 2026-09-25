/**
 * Agentic Scheduler — cron-like scheduler for autonomous background tasks.
 *
 * Supports:
 *   - Cron expressions via 'cron' package (or simple interval fallback)
 *   - Named, registered tasks with health reporting
 *   - Graceful shutdown
 *   - Concurrency limits per task type
 */
import { Logger } from '../utils/logger.js';
export class AgenticScheduler {
    tasks = new Map();
    timers = new Map();
    cronJobs = new Map();
    running = false;
    pruneInterval = null;
    /** Register a new scheduled task. */
    register(id, name, schedule, fn) {
        if (this.tasks.has(id)) {
            throw new Error(`Task already registered: ${id}`);
        }
        this.tasks.set(id, {
            id,
            name,
            schedule,
            fn,
            enabled: true,
            running: false,
        });
        Logger.info(`[AgenticScheduler] Registered task: "${name}" (${id}) schedule=${schedule}`);
    }
    /** Parse a schedule string into milliseconds (supports simple interval strings like "5m", "1h", "24h") */
    parseInterval(schedule) {
        const match = schedule.match(/^(\d+)(s|m|h|d)$/);
        if (match) {
            const value = parseInt(match[1], 10);
            const unit = match[2];
            switch (unit) {
                case 's': return value * 1000;
                case 'm': return value * 60 * 1000;
                case 'h': return value * 60 * 60 * 1000;
                case 'd': return value * 24 * 60 * 60 * 1000;
            }
        }
        // Default: parse as raw ms
        return parseInt(schedule, 10) || 3600_000; // default 1h
    }
    /** Start all registered, enabled tasks. */
    start() {
        if (this.running)
            return;
        this.running = true;
        Logger.info('[AgenticScheduler] Starting all tasks...');
        for (const task of this.tasks.values()) {
            if (!task.enabled)
                continue;
            this.startTask(task);
        }
        // Prune expired tasks / approvals every 5 minutes
        this.pruneInterval = setInterval(() => this.prune(), 5 * 60 * 1000);
    }
    startTask(task) {
        const intervalMs = this.parseInterval(task.schedule);
        const timer = setInterval(async () => {
            if (task.running) {
                Logger.warn(`[AgenticScheduler] Task "${task.name}" still running, skipping this tick`);
                return;
            }
            task.running = true;
            const start = Date.now();
            try {
                await task.fn();
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                Logger.error(`[AgenticScheduler] Task "${task.name}" failed: ${message}`);
            }
            finally {
                task.lastDurationMs = Date.now() - start;
                task.lastRun = new Date().toISOString();
                task.running = false;
            }
        }, intervalMs);
        this.timers.set(task.id, timer);
        Logger.info(`[AgenticScheduler] Started task "${task.name}" every ${task.schedule}`);
    }
    /** Enable (or re-enable) a specific task. */
    enable(id) {
        const task = this.tasks.get(id);
        if (!task)
            return false;
        if (task.enabled && this.timers.has(id))
            return true;
        task.enabled = true;
        this.startTask(task);
        return true;
    }
    /** Disable a specific task without unregistering it. */
    disable(id) {
        const task = this.tasks.get(id);
        if (!task)
            return false;
        task.enabled = true;
        const timer = this.timers.get(id);
        if (timer) {
            clearInterval(timer);
            this.timers.delete(id);
        }
        return true;
    }
    /** Unregister a task completely. */
    unregister(id) {
        this.disable(id);
        return this.tasks.delete(id);
    }
    /** Get status of all tasks. */
    getStatus() {
        return [...this.tasks.values()].map(t => ({ ...t }));
    }
    /** Get a specific task status. */
    getTask(id) {
        const task = this.tasks.get(id);
        return task ? { ...task } : undefined;
    }
    /** Run a specific task immediately (outside of its schedule). */
    async runNow(id) {
        const task = this.tasks.get(id);
        if (!task)
            return { success: false, error: `Task not found: ${id}` };
        if (task.running)
            return { success: false, error: `Task already running: ${id}` };
        task.running = true;
        const start = Date.now();
        try {
            await task.fn();
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
        finally {
            task.lastDurationMs = Date.now() - start;
            task.lastRun = new Date().toISOString();
            task.running = false;
        }
    }
    /** Clean up expired internal state. */
    prune() {
        // Override in subclasses or via injectable pruner
        Logger.debug('[AgenticScheduler] Pruning...');
    }
    /** Graceful shutdown — stops all timers. */
    async shutdown() {
        Logger.info('[AgenticScheduler] Shutting down...');
        this.running = false;
        for (const timer of this.timers.values()) {
            clearInterval(timer);
        }
        this.timers.clear();
        for (const job of this.cronJobs.values()) {
            job.stop();
        }
        this.cronJobs.clear();
        if (this.pruneInterval) {
            clearInterval(this.pruneInterval);
            this.pruneInterval = null;
        }
        Logger.info('[AgenticScheduler] Shutdown complete');
    }
}
//# sourceMappingURL=scheduler.js.map
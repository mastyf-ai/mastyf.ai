import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { onShutdown } from '../utils/shutdown.js';
function envInt(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
const MAX_QUEUE = envInt('MASTYF_AI_AUDIT_QUEUE_MAX', 5000);
const BATCH_SIZE = envInt('MASTYF_AI_AUDIT_QUEUE_BATCH', 32);
let queue = [];
let draining = false;
let db = null;
let droppedWrites = 0;
let registeredShutdown = false;
export function getAuditQueueDepth() {
    return queue.length;
}
export function getAuditDroppedWrites() {
    return droppedWrites;
}
export function initAuditWriteQueue(database) {
    db = database;
    if (!registeredShutdown) {
        registeredShutdown = true;
        onShutdown(async () => {
            await flushAuditWriteQueue();
        });
    }
}
export function enqueueAuditWrite(job) {
    if (!db) {
        Logger.warn('[audit-queue] enqueue before init — dropping write');
        droppedWrites++;
        return false;
    }
    if (queue.length >= MAX_QUEUE) {
        droppedWrites++;
        StructuredLogger.info({
            event: 'audit_queue_overflow',
            queueDepth: queue.length,
            maxQueue: MAX_QUEUE,
            droppedTotal: droppedWrites,
            serverName: job.record.serverName,
        });
        return false;
    }
    queue.push(job);
    scheduleDrain();
    return true;
}
function scheduleDrain() {
    if (draining)
        return;
    draining = true;
    setImmediate(() => {
        void drainBatch().finally(() => {
            draining = false;
            if (queue.length > 0)
                scheduleDrain();
        });
    });
}
async function drainBatch() {
    if (!db || queue.length === 0)
        return;
    const batch = queue.splice(0, Math.min(BATCH_SIZE, queue.length));
    for (const job of batch) {
        try {
            await db.addCallRecord(job.record);
            if (job.costRecord && job.costRecord.costUsd > 0) {
                const { serverName, tokens, costUsd, tenantId } = job.costRecord;
                await db.addCostRecord(serverName, tokens, costUsd, tenantId);
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.warn(`[audit-queue] write failed: ${message}`);
        }
    }
}
export async function flushAuditWriteQueue() {
    while (queue.length > 0) {
        await drainBatch();
    }
}
/** Reset for tests. */
export function resetAuditWriteQueueForTests() {
    queue = [];
    draining = false;
    db = null;
    droppedWrites = 0;
    registeredShutdown = false;
}
//# sourceMappingURL=audit-write-queue.js.map
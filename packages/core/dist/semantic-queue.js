/**
 * In-process cap for concurrent semantic scans (mirrors proxy async queue env).
 *
 * Queue limits are **per Node.js process / worker thread** — not shared across
 * cluster workers or worker_threads. For multi-replica deployments use
 * proxy-level caps (`MASTYF_AI_SEMANTIC_ASYNC_MAX_QUEUE`) or external coordination.
 *
 * Optional worker coordination: set `MASTYF_AI_SEMANTIC_QUEUE_COORD=parent` and
 * use `createSemanticQueueParentHooks()` on the main thread plus
 * `attachSemanticQueueWorker(parentPort)` in worker entry files.
 */
import { isMainThread } from "node:worker_threads";
import { isRedisSemanticQueueEnabled, tryAcquireRedisSemanticSlot, releaseRedisSemanticSlot, } from "./redis-semantic-queue.js";
let inflight = 0;
const tenantInflight = new Map();
let workerWarned = false;
export function semanticQueueMax() {
    const n = parseInt(process.env["MASTYF_AI_SEMANTIC_ASYNC_MAX_QUEUE"] ||
        process.env["MASTYF_AI_SEMANTIC_MAX_QUEUE"] ||
        "1000", 10);
    return Number.isFinite(n) && n > 0 ? n : 1000;
}
export function semanticPerTenantMax() {
    const n = parseInt(process.env["MASTYF_AI_SEMANTIC_PER_TENANT_MAX"] ||
        process.env["MASTYF_AI_SEMANTIC_PER_TENANT_MAX"] ||
        "50", 10);
    return Number.isFinite(n) && n > 0 ? n : 50;
}
export function isSemanticQueueProcessLocal() {
    return !isRedisSemanticQueueEnabled();
}
export function getSemanticQueueStats() {
    return {
        inflight,
        tenantInflight: Object.fromEntries(tenantInflight.entries()),
        processLocal: isSemanticQueueProcessLocal(),
        isMainThread,
    };
}
function warnWorkerLocalCapsOnce() {
    if (workerWarned || isMainThread)
        return;
    workerWarned = true;
    // eslint-disable-next-line no-console
    console.warn("[mastyf-ai/core] semantic queue caps are per worker thread; use main-thread scanning or proxy-level caps in multi-worker setups");
}
function tryAcquireLocalSlot(tenantId) {
    if (!isMainThread)
        warnWorkerLocalCapsOnce();
    if (inflight >= semanticQueueMax())
        return false;
    const tid = tenantId?.trim();
    if (tid) {
        const cur = tenantInflight.get(tid) || 0;
        if (cur >= semanticPerTenantMax())
            return false;
        tenantInflight.set(tid, cur + 1);
    }
    inflight += 1;
    return true;
}
export function tryAcquireSemanticSlot(tenantId) {
    return tryAcquireLocalSlot(tenantId);
}
/** Cluster-wide async acquire — Redis when configured, else local (M-001). */
export async function tryAcquireClusterSemanticSlot(tenantId) {
    if (isRedisSemanticQueueEnabled()) {
        const ok = await tryAcquireRedisSemanticSlot(tenantId);
        if (!ok)
            return false;
    }
    return tryAcquireLocalSlot(tenantId);
}
export function releaseSemanticSlot(tenantId) {
    const tid = tenantId?.trim();
    if (tid) {
        const cur = tenantInflight.get(tid) || 0;
        if (cur <= 1)
            tenantInflight.delete(tid);
        else
            tenantInflight.set(tid, cur - 1);
    }
    if (inflight > 0)
        inflight -= 1;
    if (isRedisSemanticQueueEnabled()) {
        void releaseRedisSemanticSlot(tenantId);
    }
}
export async function releaseSemanticSlotAsync(tenantId) {
    releaseSemanticSlot(tenantId);
}
/** Main thread: handle worker acquire/release messages when COORD=parent. */
export function createSemanticQueueParentHooks() {
    return {
        onWorkerMessage(msg) {
            if (process.env["MASTYF_AI_SEMANTIC_QUEUE_COORD"] !== "parent")
                return {};
            if (!msg || typeof msg !== "object")
                return {};
            const m = msg;
            if (m.type === "semantic-queue-acquire" && m.replyId != null) {
                return {
                    reply: {
                        type: "semantic-queue-acquire-result",
                        replyId: m.replyId,
                        ok: tryAcquireSemanticSlot(m.tenantId),
                    },
                };
            }
            if (m.type === "semantic-queue-release") {
                releaseSemanticSlot(m.tenantId);
            }
            return {};
        },
    };
}
/** Worker thread: listen for parent acquire results when COORD=parent. */
export function attachSemanticQueueWorker(port) {
    if (process.env["MASTYF_AI_SEMANTIC_QUEUE_COORD"] !== "parent")
        return;
    port.on("message", (msg) => {
        if (!msg || typeof msg !== "object")
            return;
        const m = msg;
        if (m.type === "semantic-queue-acquire-result" && m.replyId != null) {
            pendingAcquires.get(m.replyId)?.(Boolean(m.ok));
            pendingAcquires.delete(m.replyId);
        }
    });
}
const pendingAcquires = new Map();
/** Async acquire for worker threads delegating to parent hooks. */
export function tryAcquireSemanticSlotViaParent(port, tenantId, timeoutMs = 5000) {
    if (isMainThread || process.env["MASTYF_AI_SEMANTIC_QUEUE_COORD"] !== "parent") {
        return tryAcquireClusterSemanticSlot(tenantId);
    }
    const replyId = Date.now() + Math.random();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            pendingAcquires.delete(replyId);
            resolve(false);
        }, timeoutMs);
        pendingAcquires.set(replyId, (ok) => {
            clearTimeout(timer);
            resolve(ok);
        });
        port.postMessage({ type: "semantic-queue-acquire", replyId, tenantId: tenantId?.trim() || undefined });
    });
}
/** @internal */
export function resetSemanticQueueForTests() {
    inflight = 0;
    tenantInflight.clear();
    workerWarned = false;
    pendingAcquires.clear();
}
//# sourceMappingURL=semantic-queue.js.map
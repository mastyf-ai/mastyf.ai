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

let inflight = 0;
const tenantInflight = new Map<string, number>();
let workerWarned = false;

export function semanticQueueMax(): number {
  const n = parseInt(
    process.env["MASTYF_AI_SEMANTIC_ASYNC_MAX_QUEUE"] ||
      process.env["MASTYF_AI_SEMANTIC_MAX_QUEUE"] ||
      "1000",
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

export function semanticPerTenantMax(): number {
  const n = parseInt(
    process.env["MASTYF_AI_SEMANTIC_PER_TENANT_MAX"] ||
      process.env["MASTYF_AI_SEMANTIC_PER_TENANT_MAX"] ||
      "50",
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 50;
}

export function isSemanticQueueProcessLocal(): boolean {
  return true;
}

export function getSemanticQueueStats(): {
  inflight: number;
  tenantInflight: Record<string, number>;
  processLocal: true;
  isMainThread: boolean;
} {
  return {
    inflight,
    tenantInflight: Object.fromEntries(tenantInflight.entries()),
    processLocal: true,
    isMainThread,
  };
}

function warnWorkerLocalCapsOnce(): void {
  if (workerWarned || isMainThread) return;
  workerWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[mastyf-ai/core] semantic queue caps are per worker thread; use main-thread scanning or proxy-level caps in multi-worker setups",
  );
}

export function tryAcquireSemanticSlot(tenantId?: string): boolean {
  if (!isMainThread) warnWorkerLocalCapsOnce();
  if (inflight >= semanticQueueMax()) return false;
  const tid = tenantId?.trim();
  if (tid) {
    const cur = tenantInflight.get(tid) || 0;
    if (cur >= semanticPerTenantMax()) return false;
    tenantInflight.set(tid, cur + 1);
  }
  inflight += 1;
  return true;
}

export function releaseSemanticSlot(tenantId?: string): void {
  const tid = tenantId?.trim();
  if (tid) {
    const cur = tenantInflight.get(tid) || 0;
    if (cur <= 1) tenantInflight.delete(tid);
    else tenantInflight.set(tid, cur - 1);
  }
  if (inflight > 0) inflight -= 1;
}

/** Main thread: handle worker acquire/release messages when COORD=parent. */
export function createSemanticQueueParentHooks(): {
  onWorkerMessage: (msg: unknown) => { reply?: unknown };
} {
  return {
    onWorkerMessage(msg: unknown) {
      if (process.env["MASTYF_AI_SEMANTIC_QUEUE_COORD"] !== "parent") return {};
      if (!msg || typeof msg !== "object") return {};
      const m = msg as { type?: string; tenantId?: string; replyId?: number };
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
export function attachSemanticQueueWorker(
  port: { on: (event: string, cb: (msg: unknown) => void) => void },
): void {
  if (process.env["MASTYF_AI_SEMANTIC_QUEUE_COORD"] !== "parent") return;
  port.on("message", (msg: unknown) => {
    if (!msg || typeof msg !== "object") return;
    const m = msg as { type?: string; ok?: boolean; replyId?: number };
    if (m.type === "semantic-queue-acquire-result" && m.replyId != null) {
      pendingAcquires.get(m.replyId)?.(Boolean(m.ok));
      pendingAcquires.delete(m.replyId);
    }
  });
}

const pendingAcquires = new Map<number, (ok: boolean) => void>();

/** Async acquire for worker threads delegating to parent hooks. */
export function tryAcquireSemanticSlotAsync(
  port: { postMessage: (msg: unknown) => void },
  tenantId?: string,
  timeoutMs = 5000,
): Promise<boolean> {
  if (isMainThread || process.env["MASTYF_AI_SEMANTIC_QUEUE_COORD"] !== "parent") {
    return Promise.resolve(tryAcquireSemanticSlot(tenantId));
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
export function resetSemanticQueueForTests(): void {
  inflight = 0;
  tenantInflight.clear();
  workerWarned = false;
  pendingAcquires.clear();
}

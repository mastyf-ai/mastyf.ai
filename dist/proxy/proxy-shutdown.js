/**
 * Graceful proxy shutdown — drain in-flight HTTP/SSE slots before exit.
 */
import { getTotalProxyInflight } from './proxy-inflight.js';
export function shutdownGraceMs() {
    const n = parseInt(process.env['MASTYF_AI_SHUTDOWN_GRACE_MS'] || '30000', 10);
    return Number.isFinite(n) && n > 0 ? n : 30_000;
}
export async function drainProxyInflight(maxWaitMs = shutdownGraceMs()) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        if (getTotalProxyInflight() === 0)
            return;
        await new Promise((r) => setTimeout(r, 100));
    }
}
//# sourceMappingURL=proxy-shutdown.js.map
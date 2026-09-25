import { Logger } from './logger.js';
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_WARN_HEAP_MB = 500;
/** Periodic heap/RSS sampling for long-running proxy processes (8+ hour IDE sessions). */
export function startMemoryMonitor(options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const warnHeapMb = options.warnHeapMb ?? DEFAULT_WARN_HEAP_MB;
    const label = options.label ?? 'proxy';
    const timer = setInterval(() => {
        const { heapUsed, rss } = process.memoryUsage();
        const heapMb = heapUsed / (1024 * 1024);
        const rssMb = rss / (1024 * 1024);
        if (heapMb >= warnHeapMb) {
            Logger.warn(`[memory] Heap ${heapMb.toFixed(1)}MB RSS ${rssMb.toFixed(1)}MB exceeds ${warnHeapMb}MB (${label})`);
            if (typeof global.gc === 'function') {
                global.gc();
            }
        }
    }, intervalMs);
    if (typeof timer.unref === 'function') {
        timer.unref();
    }
    return () => clearInterval(timer);
}
//# sourceMappingURL=memory-monitor.js.map
export interface MemoryMonitorOptions {
    intervalMs?: number;
    warnHeapMb?: number;
    label?: string;
}
/** Periodic heap/RSS sampling for long-running proxy processes (8+ hour IDE sessions). */
export declare function startMemoryMonitor(options?: MemoryMonitorOptions): () => void;
//# sourceMappingURL=memory-monitor.d.ts.map
export declare function semanticQueueMax(): number;
export declare function semanticPerTenantMax(): number;
export declare function isSemanticQueueProcessLocal(): boolean;
export declare function getSemanticQueueStats(): {
    inflight: number;
    tenantInflight: Record<string, number>;
    processLocal: boolean;
    isMainThread: boolean;
};
export declare function tryAcquireSemanticSlot(tenantId?: string): boolean;
/** Cluster-wide async acquire — Redis when configured, else local (M-001). */
export declare function tryAcquireClusterSemanticSlot(tenantId?: string): Promise<boolean>;
export declare function releaseSemanticSlot(tenantId?: string): void;
export declare function releaseSemanticSlotAsync(tenantId?: string): Promise<void>;
/** Main thread: handle worker acquire/release messages when COORD=parent. */
export declare function createSemanticQueueParentHooks(): {
    onWorkerMessage: (msg: unknown) => {
        reply?: unknown;
    };
};
/** Worker thread: listen for parent acquire results when COORD=parent. */
export declare function attachSemanticQueueWorker(port: {
    on: (event: string, cb: (msg: unknown) => void) => void;
}): void;
/** Async acquire for worker threads delegating to parent hooks. */
export declare function tryAcquireSemanticSlotViaParent(port: {
    postMessage: (msg: unknown) => void;
}, tenantId?: string, timeoutMs?: number): Promise<boolean>;
/** @internal */
export declare function resetSemanticQueueForTests(): void;
//# sourceMappingURL=semantic-queue.d.ts.map
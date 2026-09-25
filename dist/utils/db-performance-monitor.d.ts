export declare function getSlowQueryThresholdMs(): number;
/** Wrap a DB operation and log when duration exceeds threshold. */
export declare function monitorDbQuery<T>(label: string, fn: () => T): T;
/** Async variant for promise-returning DB helpers. */
export declare function monitorDbQueryAsync<T>(label: string, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=db-performance-monitor.d.ts.map
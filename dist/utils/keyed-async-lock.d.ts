/**
 * Per-key async serialization — prevents lost updates on shared in-memory counters.
 */
export declare class KeyedAsyncLock {
    private readonly tails;
    runExclusive<T>(key: string, fn: () => Promise<T> | T): Promise<T>;
}
//# sourceMappingURL=keyed-async-lock.d.ts.map
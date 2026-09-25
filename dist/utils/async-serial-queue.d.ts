/**
 * Serializes async work so concurrent callers are processed one at a time.
 */
export declare class AsyncSerialQueue {
    private tail;
    enqueue<T>(fn: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=async-serial-queue.d.ts.map
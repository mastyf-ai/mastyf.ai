/**
 * Per-request serialization — avoids global AsyncSerialQueue bottleneck while
 * preventing races on the same MCP request id.
 */
export declare class RequestIdLock {
    private readonly tails;
    private globalTail;
    enqueue<T>(requestId: string | number | undefined, fn: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=request-id-lock.d.ts.map
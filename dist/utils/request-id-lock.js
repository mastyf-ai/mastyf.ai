/**
 * Per-request serialization — avoids global AsyncSerialQueue bottleneck while
 * preventing races on the same MCP request id.
 */
export class RequestIdLock {
    tails = new Map();
    globalTail = Promise.resolve();
    enqueue(requestId, fn) {
        const key = requestId != null ? String(requestId) : '__global__';
        const prev = key === '__global__' ? this.globalTail : this.tails.get(key) ?? Promise.resolve();
        const run = prev.then(fn, fn);
        const tail = run.then(() => undefined, () => undefined);
        if (key === '__global__') {
            this.globalTail = tail;
        }
        else {
            this.tails.set(key, tail);
            tail.finally(() => {
                if (this.tails.get(key) === tail)
                    this.tails.delete(key);
            });
        }
        return run;
    }
}
//# sourceMappingURL=request-id-lock.js.map
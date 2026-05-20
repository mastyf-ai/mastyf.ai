/**
 * Per-request serialization — avoids global AsyncSerialQueue bottleneck while
 * preventing races on the same MCP request id.
 */
export class RequestIdLock {
  private readonly tails = new Map<string, Promise<void>>();
  private globalTail: Promise<void> = Promise.resolve();

  enqueue<T>(requestId: string | number | undefined, fn: () => Promise<T>): Promise<T> {
    const key = requestId != null ? String(requestId) : '__global__';
    const prev = key === '__global__' ? this.globalTail : this.tails.get(key) ?? Promise.resolve();

    const run = prev.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );

    if (key === '__global__') {
      this.globalTail = tail;
    } else {
      this.tails.set(key, tail);
      tail.finally(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    }
    return run;
  }
}

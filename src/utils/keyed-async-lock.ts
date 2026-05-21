/**
 * Per-key async serialization — prevents lost updates on shared in-memory counters.
 */
export class KeyedAsyncLock {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    tail.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return run;
  }
}

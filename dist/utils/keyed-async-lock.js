/**
 * Per-key async serialization — prevents lost updates on shared in-memory counters.
 */
export class KeyedAsyncLock {
    tails = new Map();
    async runExclusive(key, fn) {
        const prev = this.tails.get(key) ?? Promise.resolve();
        const run = prev.then(fn, fn);
        const tail = run.then(() => undefined, () => undefined);
        this.tails.set(key, tail);
        tail.finally(() => {
            if (this.tails.get(key) === tail)
                this.tails.delete(key);
        });
        return run;
    }
}
//# sourceMappingURL=keyed-async-lock.js.map
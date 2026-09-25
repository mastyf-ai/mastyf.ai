/**
 * Serializes async work so concurrent callers are processed one at a time.
 */
export class AsyncSerialQueue {
    tail = Promise.resolve();
    enqueue(fn) {
        const run = this.tail.then(fn, fn);
        this.tail = run.then(() => undefined, () => undefined);
        return run;
    }
}
//# sourceMappingURL=async-serial-queue.js.map
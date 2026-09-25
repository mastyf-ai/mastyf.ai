/**
 * Worker-thread regex evaluation — isolates catastrophic backtracking from the event loop.
 * Protocol: SharedArrayBuffer int32[0]=state (0 pending, 1 done), int32[1]=matched (0/1).
 */
import { workerData } from 'node:worker_threads';

const { sab, source, flags, input } = workerData;
const state = new Int32Array(sab);

try {
  const matched = new RegExp(source, flags).test(input);
  Atomics.store(state, 1, matched ? 1 : 0);
} catch {
  Atomics.store(state, 1, 0);
}
Atomics.store(state, 0, 1);
Atomics.notify(state, 0, 1);

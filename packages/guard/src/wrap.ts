/** The one flow every adapter uses: check the call, run the tool, check the result. */
import type { Guard } from './guard.js';
import { isBlocked, modelMessage } from './verdict.js';

/**
 * Runs `run` only if the call is allowed. A blocked call or result becomes the
 * "Blocked by Mastyf (...)" text the model sees in its place; a redacted result is replaced by the
 * cleaned one.
 */
export async function guarded<T>(guard: Guard, tool: string, args: unknown, run: () => Promise<T>): Promise<T | string | unknown> {
  const before = await guard.checkCall(tool, args);
  if (isBlocked(before)) return modelMessage(before);
  const result = await run();
  const after = await guard.checkResult(tool, result, args);
  if (isBlocked(after)) return modelMessage(after);
  if (after.decision === 'redact') return after.result;
  return result;
}

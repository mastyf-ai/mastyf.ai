/**
 * Mastra: `guardTools(tools)` checks every call before the tool runs and every result before the
 * model sees it. Takes the same record (or array) of tools an Agent takes.
 *
 *   import { guardTools } from '@mastyf_ai/guard/mastra';
 *   const agent = new Agent({ name: 'helper', model, tools: guardTools({ search, readFile }) });
 */
import { createGuard, type Guard } from './guard.js';
import { guarded } from './wrap.js';

interface MastraTool {
  id: string;
  execute?: (input: any, context: any) => Promise<any>;
}

function wrap<T extends MastraTool>(tool: T, guard: Guard): T {
  const original = tool.execute;
  if (!original) return tool;
  // Same prototype and fields as the original; only execute differs.
  const copy = Object.assign(Object.create(Object.getPrototypeOf(tool)), tool) as T;
  copy.execute = (input: unknown, context: unknown) => guarded(guard, tool.id, input, () => original.call(tool, input, context));
  return copy;
}

export function guardTools<T extends MastraTool>(tools: T[], guard?: Guard): T[];
export function guardTools<R extends Record<string, MastraTool>>(tools: R, guard?: Guard): R;
export function guardTools(tools: MastraTool[] | Record<string, MastraTool>, guard: Guard = createGuard()): unknown {
  if (Array.isArray(tools)) return tools.map((t) => wrap(t, guard));
  return Object.fromEntries(Object.entries(tools).map(([k, t]) => [k, wrap(t, guard)]));
}

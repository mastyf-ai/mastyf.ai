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
  id?: string;
  inputSchema?: unknown;
  execute?: (input: any, context: any) => Promise<any>;
}

/** The input as the tool will see it: after its schema has parsed (and maybe transformed) it. */
async function asTheToolSeesIt(tool: MastraTool, input: unknown): Promise<unknown> {
  const schema = tool.inputSchema as { safeParseAsync?: (v: unknown) => Promise<{ success: boolean; data?: unknown }> } | undefined;
  if (typeof schema?.safeParseAsync !== 'function') return input;
  try {
    const parsed = await schema.safeParseAsync(input);
    return parsed.success ? parsed.data : input; // invalid input: the tool refuses it anyway
  } catch {
    return input;
  }
}

function wrap<T extends MastraTool>(tool: T, guard: Guard, key?: string): T {
  const name = tool.id ?? key ?? (tool as { name?: string }).name ?? 'tool';
  const original = tool.execute;
  if (!original) return tool;
  // Same prototype and fields as the original; only execute differs.
  const copy = Object.assign(Object.create(Object.getPrototypeOf(tool)), tool) as T;
  copy.execute = async (input: unknown, context: unknown) =>
    guarded(guard, name, await asTheToolSeesIt(tool, input), () => original.call(tool, input, context));
  return copy;
}

export function guardTools<T extends MastraTool>(tools: T[], guard?: Guard): T[];
export function guardTools<R extends Record<string, MastraTool>>(tools: R, guard?: Guard): R;
export function guardTools(tools: MastraTool[] | Record<string, MastraTool>, guard: Guard = createGuard()): unknown {
  if (Array.isArray(tools)) return tools.map((t) => wrap(t, guard));
  return Object.fromEntries(Object.entries(tools).map(([k, t]) => [k, wrap(t, guard, k)]));
}

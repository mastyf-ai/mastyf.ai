/**
 * OpenAI Agents SDK (JS): `guardTools(tools)` checks every call before the tool runs and every
 * result before the model sees it.
 *
 *   import { guardTools } from '@mastyf_ai/guard/openai-agents';
 *   const agent = new Agent({ name: 'helper', tools: guardTools([search, readFile]) });
 *
 * Hosted tools (web search, file search, code interpreter) run on OpenAI's side, out of reach of
 * any local check; they're passed through unchanged with a warning.
 */
import type { Tool } from '@openai/agents';
import { createGuard, type Guard } from './guard.js';
import { guarded } from './wrap.js';

function parse(input: string): unknown {
  try {
    return input ? JSON.parse(input) : {};
  } catch {
    return input; // checked as { input }
  }
}

export function guardTools<T extends Tool<any>>(tools: T[], guard: Guard = createGuard()): T[] {
  return tools.map((t) => {
    if (t.type !== 'function') {
      console.warn(`Mastyf: ${t.name} is a hosted tool and is not checked`);
      return t;
    }
    const original = t.invoke;
    const invoke: typeof original = async (runContext, input, details) => {
      const out = await guarded(guard, t.name, parse(input), () => original.call(t, runContext, input, details));
      return (typeof out === 'string' || (out && typeof out === 'object') ? out : JSON.stringify(out)) as Awaited<ReturnType<typeof original>>;
    };
    return { ...t, invoke } as T;
  });
}

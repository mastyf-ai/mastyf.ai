/**
 * LangChain.js: `guardTools(tools)` checks every call before the tool runs and every result before
 * the model sees it. Works with LangGraph.js's ToolNode and createReactAgent too.
 *
 *   import { guardTools } from '@mastyf_ai/guard/langchain';
 *   const agent = createReactAgent({ llm, tools: guardTools([search, readFile]) });
 */
import { DynamicStructuredTool, DynamicTool, Tool, type StructuredToolInterface } from '@langchain/core/tools';
import { createGuard, type Guard } from './guard.js';
import { guarded } from './wrap.js';

function wrap(tool: StructuredToolInterface, guard: Guard): DynamicStructuredTool | DynamicTool {
  if (tool instanceof Tool) {
    // A tool that takes one string: checked as { input: <the string> }.
    return new DynamicTool({
      name: tool.name,
      description: tool.description,
      returnDirect: tool.returnDirect,
      func: async (input: string, runManager?: { getChild?: () => unknown }) =>
        (await guarded(guard, tool.name, input, () => tool.invoke(input, { callbacks: runManager?.getChild?.() as any }))) as any,
    });
  }
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: tool.schema as any,
    returnDirect: tool.returnDirect,
    func: async (input: unknown, runManager?: { getChild?: () => unknown }) => {
      const out = await guarded(guard, tool.name, input, () => tool.invoke(input as any, { callbacks: runManager?.getChild?.() as any }));
      return out as any;
    },
  });
}

export function guardTools(tools: StructuredToolInterface[], guard: Guard = createGuard()): Array<DynamicStructuredTool | DynamicTool> {
  return tools.map((t) => wrap(t, guard));
}

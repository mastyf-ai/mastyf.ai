/**
 * LangChain.js: `guardTools(tools)` checks every call before the tool runs and every result before
 * the model sees it. Works with LangGraph.js's ToolNode and createReactAgent too.
 *
 *   import { guardTools } from '@mastyf_ai/guard/langchain';
 *   const agent = createReactAgent({ llm, tools: guardTools([search, readFile]) });
 *
 * The original tool is called exactly as LangChain would call it (same input, same run config:
 * configurable values, the tool call, callbacks), so it parses its own input once.
 */
import { ToolMessage } from '@langchain/core/messages';
import { StructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { createGuard, type Guard } from './guard.js';
import { isBlocked, modelMessage } from './verdict.js';

interface ToolCallInput {
  type: 'tool_call';
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

function isToolCall(input: unknown): input is ToolCallInput {
  return !!input && typeof input === 'object' && (input as { type?: unknown }).type === 'tool_call';
}

function isToolMessage(value: unknown): value is ToolMessage {
  return value instanceof ToolMessage || (!!value && typeof value === 'object' && (value as { _getType?: () => string })._getType?.() === 'tool');
}

/** The arguments as the tool will see them: after its schema has parsed (and maybe transformed) them. */
async function asTheToolSeesIt(schema: unknown, args: unknown): Promise<unknown> {
  const s = schema as { safeParseAsync?: (v: unknown) => Promise<{ success: boolean; data?: unknown }> } | undefined;
  if (typeof s?.safeParseAsync !== 'function') return args;
  try {
    const parsed = await s.safeParseAsync(args);
    return parsed.success ? parsed.data : args; // invalid input: the tool refuses it anyway
  } catch {
    return args;
  }
}

class GuardedTool extends StructuredTool {
  name: string;
  description: string;
  schema: any;

  constructor(
    private readonly inner: StructuredToolInterface,
    private readonly guard: Guard,
  ) {
    super();
    this.name = inner.name;
    this.description = inner.description;
    this.schema = inner.schema;
    this.returnDirect = inner.returnDirect;
  }

  protected async _call(): Promise<never> {
    throw new Error('GuardedTool runs through invoke()');
  }

  private answer(text: string, call: ToolCallInput | undefined): unknown {
    return call ? new ToolMessage({ content: text, tool_call_id: call.id ?? '', name: this.name, status: 'error' }) : text;
  }

  override async invoke(input: any, config?: any): Promise<any> {
    const call = isToolCall(input) ? input : undefined;
    const args = await asTheToolSeesIt(this.inner.schema, call ? call.args : input);
    const before = await this.guard.checkCall(this.name, args);
    if (isBlocked(before)) return this.answer(modelMessage(before), call);

    const out = await this.inner.invoke(input, config);
    const shown = isToolMessage(out) ? out.content : out;
    const after = await this.guard.checkResult(this.name, shown, args);
    if (isBlocked(after)) return this.answer(modelMessage(after), call);
    if (after.decision === 'redact') {
      const cleaned = typeof after.result === 'string' ? after.result : JSON.stringify(after.result);
      return call ? new ToolMessage({ content: cleaned, tool_call_id: call.id ?? '', name: this.name }) : after.result;
    }
    return out;
  }
}

export function guardTools(tools: StructuredToolInterface[], guard: Guard = createGuard()): StructuredTool[] {
  return tools.map((t) => new GuardedTool(t, guard));
}

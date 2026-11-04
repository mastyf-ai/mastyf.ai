/**
 * Judges the tool calls in a model's reply from the conversation that led to them. Unlike the MCP
 * proxy, a gateway in front of the model sees everything: what the user said, and what tools returned.
 * Each request carries its whole history, so it is judged on its own and nothing is kept between them.
 */
import { CausalEngine } from '../ai/causal-gate/engine.js';

export type ApiKind = 'openai' | 'anthropic';

export interface Conversation {
  /** System and user text: the anchor for what the user actually asked for. */
  trusted: string[];
  toolResults: { tool: string; text: string }[];
}

export interface ToolCall {
  name: string;
  args: unknown;
}

export interface BlockedCall {
  name: string;
  message: string;
}

type Dict = Record<string, unknown>;

const SESSION = { connectionId: 'request' };

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (isDict(part) && typeof part['text'] === 'string' ? part['text'] : ''))
    .filter(Boolean)
    .join('\n');
}

export function parseConversation(kind: ApiKind, body: unknown): Conversation {
  const out: Conversation = { trusted: [], toolResults: [] };
  if (!isDict(body)) return out;
  const names = new Map<string, string>();
  if (kind === 'anthropic' && body['system']) {
    const system = textOf(body['system']);
    if (system) out.trusted.push(system);
  }
  const messages = Array.isArray(body['messages']) ? body['messages'] : [];
  for (const message of messages) {
    if (!isDict(message)) continue;
    const role = message['role'];
    if (kind === 'openai') {
      if (role === 'system' || role === 'developer' || role === 'user') {
        const text = textOf(message['content']);
        if (text) out.trusted.push(text);
      } else if (role === 'assistant' && Array.isArray(message['tool_calls'])) {
        for (const call of message['tool_calls']) {
          if (!isDict(call) || !isDict(call['function'])) continue;
          names.set(String(call['id']), String(call['function']['name']));
        }
      } else if (role === 'tool' || role === 'function') {
        const tool = names.get(String(message['tool_call_id'])) ?? String(message['name'] ?? 'tool');
        out.toolResults.push({ tool, text: textOf(message['content']) });
      }
      continue;
    }
    if (role === 'user' && typeof message['content'] === 'string') {
      out.trusted.push(message['content']);
      continue;
    }
    if (!Array.isArray(message['content'])) continue;
    for (const block of message['content']) {
      if (!isDict(block)) continue;
      if (block['type'] === 'tool_use') names.set(String(block['id']), String(block['name']));
      else if (block['type'] === 'tool_result') {
        const tool = names.get(String(block['tool_use_id'])) ?? 'tool';
        out.toolResults.push({ tool, text: textOf(block['content']) });
      } else if (block['type'] === 'text' && role === 'user' && typeof block['text'] === 'string') {
        out.trusted.push(block['text']);
      }
    }
  }
  return out;
}

/** A model's arguments are a string it wrote, so they may not parse. They are still evidence. */
export function parseToolArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export function toolCallsInResponse(kind: ApiKind, response: unknown): ToolCall[] {
  if (!isDict(response)) return [];
  const calls: ToolCall[] = [];
  if (kind === 'openai') {
    for (const choice of Array.isArray(response['choices']) ? response['choices'] : []) {
      if (!isDict(choice) || !isDict(choice['message']) || !Array.isArray(choice['message']['tool_calls'])) continue;
      for (const call of choice['message']['tool_calls']) {
        if (!isDict(call) || !isDict(call['function'])) continue;
        calls.push({ name: String(call['function']['name']), args: parseToolArgs(call['function']['arguments']) });
      }
    }
    return calls;
  }
  for (const block of Array.isArray(response['content']) ? response['content'] : []) {
    if (isDict(block) && block['type'] === 'tool_use') calls.push({ name: String(block['name']), args: block['input'] ?? {} });
  }
  return calls;
}

export function judgeCalls(conversation: Conversation, calls: ToolCall[]): { blocked: BlockedCall[] } {
  const engine = new CausalEngine();
  for (const text of conversation.trusted) engine.trust(SESSION, text);
  for (const result of conversation.toolResults) engine.observe(SESSION, 'llm', result.tool, result.text);
  const blocked: BlockedCall[] = [];
  for (const call of calls) {
    const decision = engine.check(SESSION, call.name, call.args);
    if (decision.action !== 'allow') blocked.push({ name: call.name, message: decision.message });
  }
  return { blocked };
}

export function judgeConversation(kind: ApiKind, body: unknown, response: unknown): { blocked: BlockedCall[] } {
  return judgeCalls(parseConversation(kind, body), toolCallsInResponse(kind, response));
}

export function refusalText(blocked: BlockedCall[]): string {
  return `Mastyf blocked ${blocked.length === 1 ? 'a tool call' : 'tool calls'}, because data the agent read appears to have caused ${blocked.length === 1 ? 'it' : 'them'}. ${blocked.map((b) => b.message).join(' ')}`;
}

/** The reply with blocked calls removed and an explanation in their place. */
export function applyVerdictToResponse(kind: ApiKind, response: unknown, blocked: BlockedCall[]): unknown {
  if (blocked.length === 0 || !isDict(response)) return response;
  const names = new Set(blocked.map((b) => b.name));
  const notice = refusalText(blocked);
  if (kind === 'openai') {
    const choices = (response['choices'] as Dict[]).map((choice) => {
      const message = choice['message'] as Dict;
      const kept = ((message['tool_calls'] as Dict[] | undefined) ?? []).filter(
        (call) => !names.has(String((call['function'] as Dict)['name'])),
      );
      const { tool_calls: _dropped, ...rest } = message;
      if (kept.length > 0) return { ...choice, message: { ...rest, tool_calls: kept } };
      const before = typeof rest['content'] === 'string' && rest['content'] ? `${rest['content']}\n\n` : '';
      return { ...choice, finish_reason: 'stop', message: { ...rest, content: `${before}${notice}` } };
    });
    return { ...response, choices };
  }
  const content = (response['content'] as Dict[]).filter(
    (block) => !(block['type'] === 'tool_use' && names.has(String(block['name']))),
  );
  const toolsLeft = content.some((block) => block['type'] === 'tool_use');
  return {
    ...response,
    content: [...content, { type: 'text', text: notice }],
    stop_reason: toolsLeft ? response['stop_reason'] : 'end_turn',
  };
}

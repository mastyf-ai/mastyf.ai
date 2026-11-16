/**
 * Puts the free checks in front of one MCP server that speaks newline-delimited JSON-RPC on stdio.
 * The agent talks to this process; this process talks to the server it started.
 *
 * Everything the server sends is untrusted. Agent → server: each tools/call is checked before the
 * server sees it, and a call whose arguments aren't an object is refused rather than forwarded
 * unchecked. Server → agent: tool results AND error messages are checked; tools/list replies are
 * checked for injected text and recorded, and a changed or poisoned list never reaches the agent;
 * requests the server sends on its own (sampling, elicitation) are checked too. JSON-RPC batches
 * (arrays) are refused both ways: MCP doesn't use them, and they would hide messages from the checks.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { CheckEngine, ToolDef, Verdict } from './engine';

type Id = string | number | null;
type Message = { jsonrpc?: string; id?: Id; method?: string; params?: any; result?: any; error?: any };

export interface ProxyOptions {
  command: string;
  args: string[];
  /** The agent side. */
  input: Readable;
  output: Writable;
  log: (line: string) => void;
  server?: string;
  env?: NodeJS.ProcessEnv;
}

const BLOCK_CODE = -32001;
const FAILED: Verdict = { decision: 'block', id: 'error', reason: 'the check failed', layer: 'policy', rule: 'check-error' };

function blockedReply(id: Id | undefined, v: Verdict): Message {
  const why = [v.layer, v.rule].filter(Boolean).join(': ');
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: BLOCK_CODE, message: `Blocked by Mastyf AI${why ? ` (${why})` : ''}`, data: { id: v.id, layer: v.layer, rule: v.rule } },
  };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const hasId = (m: Message) => m.id !== undefined && m.id !== null;

/** One JSON-RPC message, or null for anything else (bad JSON, a batch, a scalar). */
function parseOne(line: string): Message | null | 'batch' {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return 'batch';
  return isPlainObject(parsed) ? (parsed as Message) : null;
}

export function startStdioProxy(engine: CheckEngine, opts: ProxyOptions): { close(): Promise<void>; child: ChildProcess } {
  const server = opts.server ?? 'stdio';
  const session = randomUUID();
  const child = spawn(opts.command, opts.args, { stdio: ['pipe', 'pipe', 'inherit'], env: opts.env ?? process.env, windowsHide: true });
  /** Agent requests in flight whose replies the proxy must look at: id → method and tool. */
  const pending = new Map<string, { method: string; tool?: string; args?: Record<string, unknown> }>();
  const write = (stream: Writable, msg: Message) => stream.write(`${JSON.stringify(msg)}\n`);
  const note = (fields: Record<string, unknown>) => opts.log(JSON.stringify(fields));

  const checkText = async (tool: string, payload: unknown, args?: Record<string, unknown>): Promise<Verdict> => {
    try {
      return await engine.checkResult({ tool, result: payload, arguments: args, server, session });
    } catch {
      return FAILED;
    }
  };

  // Agent → server.
  createInterface({ input: opts.input }).on('line', (line) => {
    void (async () => {
      const msg = parseOne(line);
      if (msg === 'batch') {
        note({ kind: 'refused', from: 'agent', why: 'batch' });
        return write(opts.output, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batches are not supported by the Mastyf proxy' } });
      }
      if (!msg) return;
      // Every request with an id is recorded before any check runs, so its reply is known and looked at.
      if (msg.method && hasId(msg)) pending.set(String(msg.id), { method: msg.method });
      if (msg.method === 'tools/call') {
        const tool = String(msg.params?.name ?? '');
        const rawArgs = msg.params?.arguments;
        if (rawArgs !== undefined && !isPlainObject(rawArgs)) {
          note({ kind: 'call', tool, decision: 'block', rule: 'arguments-not-object' });
          if (hasId(msg)) pending.delete(String(msg.id));
          return write(opts.output, blockedReply(msg.id, { decision: 'block', id: 'shape', layer: 'policy', rule: 'arguments-not-object' }));
        }
        const args = (rawArgs as Record<string, unknown> | undefined) ?? {};
        let v: Verdict;
        try {
          v = await engine.checkCall({ tool, arguments: args, server, session });
        } catch (err) {
          note({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
          v = FAILED;
        }
        note({ kind: 'call', tool, decision: v.decision, layer: v.layer, rule: v.rule });
        if (v.decision === 'block') {
          if (hasId(msg)) pending.delete(String(msg.id));
          return write(opts.output, blockedReply(msg.id, v));
        }
        if (hasId(msg)) pending.set(String(msg.id), { method: 'tools/call', tool, args });
      }
      write(child.stdin!, msg);
    })();
  });

  // Server → agent: everything here is untrusted.
  createInterface({ input: child.stdout! }).on('line', (line) => {
    void (async () => {
      const msg = parseOne(line);
      if (msg === 'batch' || !msg) {
        note({ kind: 'refused', from: 'server', why: msg === 'batch' ? 'batch' : 'not a JSON-RPC message' });
        return;
      }

      // A message can't be both a request and a reply: refused, as it would be read two ways.
      if (msg.method && (msg.result !== undefined || msg.error !== undefined)) {
        note({ kind: 'refused', from: 'server', why: 'request and reply in one message' });
        return;
      }

      // A request or notification the server sends on its own (sampling, elicitation, logging...).
      if (msg.method) {
        const v = await checkText(`server:${msg.method}`, msg.params ?? {});
        const clean: Message = { jsonrpc: '2.0', method: msg.method, ...(msg.params !== undefined ? { params: msg.params } : {}), ...(hasId(msg) ? { id: msg.id } : {}) };
        note({ kind: 'server-request', method: msg.method, decision: v.decision, layer: v.layer, rule: v.rule });
        if (v.decision === 'block') {
          if (hasId(msg)) write(child.stdin!, blockedReply(msg.id, v)); // tell the server no
          return;
        }
        if (v.decision === 'redact') return write(opts.output, { ...clean, params: v.result });
        return write(opts.output, clean);
      }

      // A reply: only to a request the agent actually sent and that hasn't been answered yet.
      const req = hasId(msg) ? pending.get(String(msg.id)) : undefined;
      if (!req) {
        note({ kind: 'refused', from: 'server', why: 'reply to an id the agent did not send (or already answered)' });
        return;
      }
      pending.delete(String(msg.id));

      // A reply carries exactly one of result or error; anything else is refused. What the agent
      // receives is rebuilt from {jsonrpc, id} plus the one part that was checked, never the original.
      const hasResult = msg.result !== undefined;
      const hasError = msg.error !== undefined;
      if (hasResult === hasError) {
        note({ kind: 'refused', from: 'server', why: 'reply must have exactly one of result or error' });
        return write(opts.output, blockedReply(msg.id, { decision: 'block', id: 'shape', layer: 'policy', rule: 'malformed-reply' }));
      }
      const key = hasResult ? 'result' : 'error';
      const reply = (part: unknown): Message => ({ jsonrpc: '2.0', id: msg.id, [key]: part });

      if (req.method === 'tools/list' && hasResult) {
        if (!Array.isArray(msg.result?.tools)) {
          return write(opts.output, blockedReply(msg.id, { decision: 'block', id: 'shape', layer: 'lifecycle', rule: 'tools-not-a-list' }));
        }
        const changed = engine.registerTools(server, msg.result.tools as ToolDef[], session);
        const poisoned = changed ? null : await checkText('tools/list', msg.result);
        const v = changed ?? poisoned!;
        note({ kind: 'tools', decision: v.decision, layer: v.layer, rule: v.rule });
        if (v.decision === 'block') return write(opts.output, blockedReply(msg.id, v));
        return write(opts.output, reply(v.decision === 'redact' ? v.result : msg.result));
      }

      // Tool results, errors, resources, prompts, initialize...: all of it can reach the model.
      const part = hasResult ? msg.result : msg.error;
      const v = req.method === 'tools/call' ? await checkText(req.tool ?? '', part, req.args) : await checkText(req.method, part);
      note({ kind: req.method === 'tools/call' ? 'result' : 'reply', method: req.method, tool: req.tool, decision: v.decision, layer: v.layer, rule: v.rule });
      if (v.decision === 'block') return write(opts.output, blockedReply(msg.id, v));
      write(opts.output, reply(v.decision === 'redact' ? v.result : part));
    })();
  });

  child.on('exit', (code) => note({ kind: 'server-exit', code }));

  return {
    child,
    close: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.stdin?.end();
        child.kill();
      }),
  };
}

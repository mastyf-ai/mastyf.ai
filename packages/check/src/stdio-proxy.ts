/**
 * Puts the free checks in front of one MCP server that speaks newline-delimited JSON-RPC on stdio.
 * The agent talks to this process; this process talks to the server it started. Each tools/call is
 * checked before the server sees it, each result before the agent sees it, and each tools/list reply
 * is recorded so a server that changes its tools mid-session is noticed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { CheckEngine, ToolDef, Verdict } from './engine';

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any; result?: any; error?: any };

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

function blockedReply(id: Message['id'], v: Verdict): Message {
  const why = [v.layer, v.rule].filter(Boolean).join(': ');
  return {
    jsonrpc: '2.0',
    id,
    error: { code: BLOCK_CODE, message: `Blocked by Mastyf AI${why ? ` (${why})` : ''}`, data: { id: v.id, layer: v.layer, rule: v.rule } },
  };
}

export function startStdioProxy(engine: CheckEngine, opts: ProxyOptions): { close(): Promise<void>; child: ChildProcess } {
  const server = opts.server ?? 'stdio';
  const session = randomUUID();
  const child = spawn(opts.command, opts.args, { stdio: ['pipe', 'pipe', 'inherit'], env: opts.env ?? process.env, windowsHide: true });
  /** Requests in flight that the proxy must look at on the way back: id → the method and tool. */
  const pending = new Map<string, { method: string; tool?: string; args?: Record<string, unknown> }>();
  const write = (stream: Writable, msg: Message) => stream.write(`${JSON.stringify(msg)}\n`);

  // Agent → server.
  createInterface({ input: opts.input }).on('line', (line) => {
    void (async () => {
      let msg: Message;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // not JSON-RPC: dropped, as the server would reject it
      }
      if (msg.id !== undefined && msg.id !== null && (msg.method === 'tools/call' || msg.method === 'tools/list')) {
        pending.set(String(msg.id), { method: msg.method, tool: msg.params?.name, args: msg.params?.arguments });
      }
      if (msg.method === 'tools/call') {
        const tool = String(msg.params?.name ?? '');
        const args = msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {};
        let v: Verdict;
        try {
          v = await engine.checkCall({ tool, arguments: args, server, session });
        } catch (err) {
          opts.log(JSON.stringify({ kind: 'error', message: err instanceof Error ? err.message : String(err) }));
          v = { decision: 'block', id: 'error', reason: 'the check failed', layer: 'policy', rule: 'check-error' };
        }
        opts.log(JSON.stringify({ kind: 'call', tool, decision: v.decision, layer: v.layer, rule: v.rule }));
        if (v.decision === 'block') {
          pending.delete(String(msg.id));
          return write(opts.output, blockedReply(msg.id, v));
        }
      }
      write(child.stdin!, msg);
    })();
  });

  // Server → agent.
  createInterface({ input: child.stdout! }).on('line', (line) => {
    void (async () => {
      let msg: Message;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const req = msg.id !== undefined && msg.id !== null ? pending.get(String(msg.id)) : undefined;
      if (req) pending.delete(String(msg.id));
      if (req?.method === 'tools/list' && Array.isArray(msg.result?.tools)) {
        const changed = engine.registerTools(server, msg.result.tools as ToolDef[], session);
        if (changed) opts.log(JSON.stringify({ kind: 'tools', decision: 'block', layer: changed.layer, rule: changed.rule }));
      }
      if (req?.method === 'tools/call' && msg.result !== undefined) {
        let v: Verdict;
        try {
          v = await engine.checkResult({ tool: req.tool ?? '', result: msg.result, arguments: req.args, server, session });
        } catch {
          v = { decision: 'block', id: 'error', reason: 'the check failed', layer: 'answer-check', rule: 'check-error' };
        }
        opts.log(JSON.stringify({ kind: 'result', tool: req.tool, decision: v.decision, layer: v.layer, rule: v.rule }));
        if (v.decision === 'block') return write(opts.output, blockedReply(msg.id, v));
        if (v.decision === 'redact') return write(opts.output, { ...msg, result: v.result });
      }
      write(opts.output, msg);
    })();
  });

  child.on('exit', (code) => opts.log(JSON.stringify({ kind: 'server-exit', code })));

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

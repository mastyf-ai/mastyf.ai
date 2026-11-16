/**
 * `createGuard()`: checks an agent's tool calls and results.
 *
 * One check service is shared by every guard in the process. Each guard is one agent run (its own
 * session), so two agents in one process don't affect each other's session checks.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { CheckClient } from './client.js';
import { configured, runningLocal, shieldClient } from './discovery.js';
import { assertNode, findEngine, startEngine, type Running } from './engine-process.js';
import { MastyfRefusedError, MastyfUnavailableError, type Verdict } from './verdict.js';

let client: CheckClient | null = null;
let tier: string | null = null;
let started: Running | null = null;
let connecting: Promise<void> | null = null;

function home(): string {
  return process.env['HOME'] || process.env['USERPROFILE'] || homedir();
}

async function connect(): Promise<void> {
  const env = process.env;
  const found = (await configured(env)) ?? (await runningLocal(env, home())) ?? (await shieldClient());
  if (found) {
    client = found.client;
    tier = found.tier;
    return;
  }
  assertNode();
  const old = started;
  started = null;
  await old?.stop(); // never leave an old one behind
  const token = randomBytes(32).toString('base64url');
  started = await startEngine(findEngine(env), token);
  client = new CheckClient(started.url, token, 10_000, ENGINE_MAX_BODY_MB * 1024 * 1024);
  tier = 'free';
}

const ENGINE_MAX_BODY_MB = 32; // what the started engine accepts (--max-body)
const REFUSED: Verdict = { decision: 'block', id: 'refused', layer: 'service', rule: 'input-refused', reason: 'the check service refused this input' };

async function service(reconnect = false): Promise<CheckClient> {
  while (connecting) await connecting.catch(() => {});
  if (reconnect || !client || (started && !started.alive())) {
    client = null;
    connecting = connect();
    try {
      await connecting;
    } finally {
      connecting = null;
    }
  }
  if (!client) throw new MastyfUnavailableError('no check service');
  return client;
}

/** The engine this process started, if any (for tests and diagnostics). */
export function _running(): Running | null {
  return started;
}

export async function _resetForTests(): Promise<void> {
  const s = started;
  client = null;
  tier = null;
  started = null;
  await s?.stop();
}

/** Anything a tool returns, in a form the check can read; nothing is ever skipped. */
export function jsonable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return String(value);
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (ArrayBuffer.isView(value)) return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value));
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || value instanceof Set) return [...value].map((v) => jsonable(v, seen));
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), jsonable(v, seen)]));
  const toJSON = (value as { toJSON?: () => unknown }).toJSON;
  if (typeof toJSON === 'function') {
    try {
      return jsonable(toJSON.call(value), seen);
    } catch {
      /* fall through to the fields */
    }
  }
  // Every own field, plus a text getter some classes keep off the instance.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v !== 'function') out[k] = jsonable(v, seen);
  for (const k of ['pageContent', 'content', 'text']) {
    if (!(k in out)) {
      const v = (value as Record<string, unknown>)[k];
      if (typeof v === 'string' || (v && typeof v === 'object')) out[k] = jsonable(v, seen);
    }
  }
  const base = Object.keys(out).length ? out : String(value);
  // A custom toString is what frameworks show the model for an object: check that text as well,
  // beside the fields (so no field of the object can stand in for it).
  const toString = (value as { toString?: unknown }).toString;
  if (typeof toString === 'function' && toString !== Object.prototype.toString) {
    try {
      return { value: base, shown: String(value) };
    } catch {
      /* nothing to add */
    }
  }
  return base;
}

function asArguments(args: unknown): Record<string, unknown> {
  const j = jsonable(args);
  return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : { input: j };
}

export interface GuardOptions {
  /** One agent run. Defaults to a random id. */
  session?: string;
  /** "block" (default): with no check service, calls throw MastyfUnavailableError. "allow": they go through unchecked, with a warning. */
  onUnavailable?: 'block' | 'allow';
  /** The name the checks see for this agent's tools. */
  server?: string;
}

export interface Guard {
  readonly session: string;
  /** "free" or "shield" once a check service is in use. */
  readonly tier: string | null;
  checkCall(tool: string, args: unknown): Promise<Verdict>;
  checkResult(tool: string, result: unknown, args?: unknown): Promise<Verdict>;
  registerTools(tools: unknown[]): Promise<Verdict | null>;
}

export function createGuard(options: GuardOptions = {}): Guard {
  const session = options.session ?? randomUUID();
  const server = options.server ?? 'agent';
  const onUnavailable = options.onUnavailable ?? 'block';

  async function ask<T>(question: (c: CheckClient) => Promise<T>, unchecked: () => T, what: string, refused: () => T): Promise<T> {
    try {
      try {
        return await question(await service());
      } catch (err) {
        if (!(err instanceof MastyfUnavailableError) || err instanceof MastyfRefusedError || !started || started.alive()) throw err;
        return await question(await service(true)); // the engine this process started died: once more
      }
    } catch (err) {
      if (err instanceof MastyfRefusedError) return refused(); // never let through, in either mode
      if (err instanceof MastyfUnavailableError && onUnavailable === 'allow') {
        console.warn(`Mastyf: ${what} not checked (${err.message})`);
        return unchecked();
      }
      throw err;
    }
  }

  const allowUnchecked = (): Verdict => ({ decision: 'allow', id: 'unavailable', reason: 'not checked: no check service' });

  return {
    session,
    get tier() {
      return tier;
    },
    checkCall: (tool, args) => ask((c) => c.checkCall(tool, asArguments(args), { server, session }), allowUnchecked, 'tool call', () => REFUSED),
    checkResult: (tool, result, args) =>
      ask(
        (c) => c.checkResult(tool, jsonable(result), { server, session, ...(args === undefined ? {} : { arguments: asArguments(args) }) }),
        allowUnchecked,
        'tool result',
        () => REFUSED,
      ),
    registerTools: (tools) => ask((c) => c.registerTools(server, jsonable(tools) as unknown[], { session }), () => null, 'tool definitions', () => REFUSED),
  };
}

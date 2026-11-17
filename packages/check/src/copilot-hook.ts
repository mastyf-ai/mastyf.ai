/**
 * `mastyf-check copilot-hook pre|post`: a hook for GitHub Copilot's coding agent, configured in
 * the repository's .github/hooks/mastyf.json (see init-copilot). It checks each tool call
 * (preToolUse) and each result (postToolUse) with the free checks, on the session's own machine.
 *
 * Copilot lets a call through when a hook times out, and skips a post hook that errors, so this
 * hook never does either: every failure becomes an answer (deny / withhold) within its deadline.
 */
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';

/** One HTTP request on a connection that is closed afterwards (nothing keeps the hook alive). */
function http(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs: number }): Promise<{ status: number; json: unknown }> {
  return new Promise((ok, fail) => {
    const req = request(url, { method: opts.method ?? 'GET', headers: { ...opts.headers, connection: 'close' }, agent: false, timeout: opts.timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          ok({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (err) {
          fail(err);
        }
      });
      res.on('error', fail);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', fail);
    req.end(opts.body);
  });
}

const CANT_CHECK_CALL = "Mastyf couldn't check this tool call, so it was blocked.";
const CANT_CHECK_RESULT = "Mastyf couldn't check this result, so it was withheld.";
const PROTECTED_REASON = "Blocked by Mastyf (copilot: protected-hooks). The repository's Copilot hooks can't be changed during a session.";
const READY = /listening on (http:\/\/127\.0\.0\.1:\d+)/;
// Best effort only: shell text can always be written another way.
const PROTECTED = /\.github[\\/]+hooks|mastyf-check\.c?js/i;

export interface HookOptions {
  /** The engine bundle to start (this program). */
  engine: string;
  /** Where the session's state (URL, token, pid), lock and engine log live. */
  stateDir: string;
  deadlineMs?: number;
}

interface State {
  url: string;
  token: string;
  pid: number;
}

interface Verdict {
  decision: 'allow' | 'block' | 'redact';
  layer?: string;
  rule?: string;
  result?: unknown;
}

const deny = (reason: string) => JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: reason });
const replace = (text: string) => JSON.stringify({ modifiedResult: { resultType: 'success', textResultForLlm: text } });

function message(v: Verdict): string {
  const parts = [v.layer, v.rule].filter(Boolean).join(': ');
  return parts ? `Blocked by Mastyf (${parts}).` : 'Blocked by Mastyf.';
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function proves(s: State): Promise<boolean> {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(s.url) || !pidAlive(s.pid)) return false;
  try {
    const nonce = randomBytes(16).toString('hex');
    const res = await http(`${s.url}/v1/health?nonce=${nonce}`, { timeoutMs: 3000 });
    const h = res.json as { proof?: string };
    const want = Buffer.from(createHmac('sha256', s.token).update(nonce).digest('hex'));
    const got = Buffer.from(String(h.proof ?? ''));
    return res.status === 200 && got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

function readState(dir: string): State | null {
  try {
    const s = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as State;
    return typeof s.url === 'string' && typeof s.token === 'string' && typeof s.pid === 'number' ? s : null;
  } catch {
    return null;
  }
}

async function startEngine(opts: HookOptions, until: number): Promise<State> {
  if (!existsSync(opts.engine)) throw new Error('engine missing');
  const token = randomBytes(32).toString('base64url');
  const log = join(opts.stateDir, 'engine.log');
  const fd = openSync(log, 'a');
  const child = spawn(process.execPath, [opts.engine, 'serve', '--port', '0', '--max-body', '32'], {
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: { ...process.env, MASTYF_CHECK_TOKEN: token },
  });
  closeSync(fd);
  child.unref();
  let exited = false;
  child.once('exit', () => (exited = true));
  child.once('error', () => (exited = true));
  const pid = child.pid ?? 0;
  while (Date.now() < until && !exited) {
    const m = READY.exec(readFileSync(log, 'utf8').split(/\r?\n/).slice(-50).join('\n'));
    if (m && pidAlive(pid)) {
      const state = { url: m[1]!, token, pid };
      const tmp = join(opts.stateDir, `state.${process.pid}.tmp`);
      writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
      renameSync(tmp, join(opts.stateDir, 'state.json'));
      return state;
    }
    await sleep(100);
  }
  try {
    if (pid) process.kill(pid);
  } catch {
    /* gone */
  }
  throw new Error('engine did not start');
}

/** The session's check service: reuse it if it proves itself, else start one (once, under a lock). */
async function service(opts: HookOptions, until: number): Promise<State> {
  mkdirSync(opts.stateDir, { recursive: true });
  const lock = join(opts.stateDir, 'start.lock');
  while (Date.now() < until) {
    const s = readState(opts.stateDir);
    if (s && (await proves(s))) return s;
    let fd: number | null = null;
    try {
      fd = openSync(lock, 'wx');
    } catch {
      // Someone else is starting it; a lock older than 30 s was left by a hook that died.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) rmSync(lock, { force: true });
      } catch {
        /* gone already */
      }
      await sleep(150);
      continue;
    }
    try {
      const again = readState(opts.stateDir);
      if (again && (await proves(again))) return again;
      return await startEngine(opts, until);
    } finally {
      closeSync(fd);
      rmSync(lock, { force: true });
    }
  }
  throw new Error('timed out');
}

async function ask(s: State, path: string, body: unknown, until: number): Promise<Verdict> {
  const res = await http(`${s.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
    body: JSON.stringify(body),
    timeoutMs: Math.max(1000, until - Date.now()),
  });
  if (res.status !== 200) throw new Error(`answered ${res.status}`);
  const v = res.json as Verdict;
  if (v.decision !== 'allow' && v.decision !== 'block' && v.decision !== 'redact') throw new Error('not a verdict');
  return v;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      /* a plain string */
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { input: v ?? null };
}

function touchesHooks(args: Record<string, unknown>): boolean {
  return PROTECTED.test(JSON.stringify(args));
}

const WRITES = /^(create|edit|str_replace_editor|apply_patch|write|multiedit|notebookedit|bash|powershell)$/i;

async function decide(kind: 'pre' | 'post', stdin: string, opts: HookOptions, until: number): Promise<string> {
  const input = JSON.parse(stdin) as Record<string, unknown>;
  if (!input || typeof input !== 'object') throw new Error('not an object');
  const tool = String(input['toolName'] ?? input['tool_name'] ?? '');
  const args = parseArgs(input['toolArgs'] ?? input['tool_input']);
  const where = { server: 'copilot', session: String(input['sessionId'] ?? input['session_id'] ?? '') };

  if (kind === 'pre') {
    if (WRITES.test(tool) && touchesHooks(args)) return deny(PROTECTED_REASON);
    const v = await ask(await service(opts, until), '/v1/check/call', { tool, arguments: args, ...where }, until);
    return v.decision === 'block' ? deny(message(v)) : '';
  }

  const tr = input['toolResult'] as { textResultForLlm?: unknown } | undefined;
  const result = tr && typeof tr === 'object' ? tr.textResultForLlm : input['tool_response'];
  const v = await ask(await service(opts, until), '/v1/check/result', { tool, result: result ?? null, arguments: args, ...where }, until);
  if (v.decision === 'block') return replace(message(v));
  if (v.decision === 'redact') {
    if (v.result === undefined) return replace(message(v));
    return replace(typeof v.result === 'string' ? v.result : JSON.stringify(v.result));
  }
  return '';
}

/** What to print on stdout. Never throws, never takes longer than the deadline. */
export async function copilotHook(kind: 'pre' | 'post', stdin: string, opts: HookOptions): Promise<string> {
  const failed = kind === 'pre' ? deny(CANT_CHECK_CALL) : replace(CANT_CHECK_RESULT);
  const deadline = opts.deadlineMs ?? 25_000;
  const until = Date.now() + deadline - 500;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<string>((ok) => {
    timer = setTimeout(() => ok(failed), deadline);
  });
  try {
    return await Promise.race([decide(kind, stdin, opts, until).catch(() => failed), late]);
  } finally {
    clearTimeout(timer);
  }
}

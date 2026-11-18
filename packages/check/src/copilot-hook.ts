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
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';

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
const PROTECTED = /\.github[\\/]+hooks|mastyf-check\.c?js|mastyf-copilot-/i;

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

async function proves(s: State, until: number): Promise<boolean> {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(s.url) || !pidAlive(s.pid)) return false;
  try {
    const nonce = randomBytes(16).toString('hex');
    const left = until - Date.now();
    if (left <= 0) return false;
    const res = await http(`${s.url}/v1/health?nonce=${nonce}`, { timeoutMs: Math.min(3000, left) });
    const h = res.json as { proof?: string };
    const want = Buffer.from(createHmac('sha256', s.token).update(nonce).digest('hex'));
    const got = Buffer.from(String(h.proof ?? ''));
    return res.status === 200 && got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

const POSIX = process.platform !== 'win32';

/**
 * The state folder: a real folder (not a link or junction anywhere in its last step), ours, and
 * owner-only. Anything else is refused, so another user can't plant a service for us to trust.
 */
function secureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  // Junctions on Windows don't show as links, so also compare real paths: the folder must be
  // exactly its (real) parent plus its own name.
  const expected = join(realpathSync(dirname(resolve(dir))), basename(resolve(dir)));
  const same = POSIX ? realpathSync(dir) === expected : realpathSync(dir).toLowerCase() === expected.toLowerCase();
  if (st.isSymbolicLink() || !st.isDirectory() || !same) throw new Error('state folder is not a plain folder');
  if (POSIX) {
    if (st.uid !== process.getuid!()) throw new Error('state folder belongs to someone else');
    if ((st.mode & 0o077) !== 0) chmodSync(dir, 0o700);
  }
}

/** A state file another user (or a link) put there is never trusted. */
function ownFile(file: string): boolean {
  const st = lstatSync(file);
  if (st.isSymbolicLink() || !st.isFile()) return false;
  return !POSIX || (st.uid === process.getuid!() && (st.mode & 0o077) === 0);
}

function portOpen(url: string, ms: number): Promise<boolean> {
  return new Promise((ok) => {
    if (ms <= 0) return ok(false);
    const u = new URL(url);
    const sock = connect({ host: u.hostname, port: Number(u.port) });
    const done = (v: boolean) => {
      sock.destroy();
      ok(v);
    };
    sock.setTimeout(ms, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function readState(dir: string): State | null {
  try {
    if (!ownFile(join(dir, 'state.json'))) return null;
    const s = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as State;
    return typeof s.url === 'string' && typeof s.token === 'string' && typeof s.pid === 'number' ? s : null;
  } catch {
    return null;
  }
}

async function startEngine(opts: HookOptions, until: number): Promise<State> {
  if (!existsSync(opts.engine)) throw new Error('engine missing');
  const token = randomBytes(32).toString('base64url');
  // A log of its own: a shared log would still hold the address of an engine that died.
  const log = join(opts.stateDir, `engine.${randomBytes(6).toString('hex')}.log`);
  const fd = POSIX ? openSync(log, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600) : openSync(log, 'a');
  const policy = join(dirname(opts.engine), 'check-default-policy.yaml');
  const args = [opts.engine, 'serve', '--port', '0', '--max-body', '32', ...(existsSync(policy) ? ['--policy', policy] : [])];
  const child = spawn(process.execPath, args, {
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
    const m = READY.exec(readFileSync(log, 'utf8'));
    if (m && pidAlive(pid)) {
      const state = { url: m[1]!, token, pid };
      if (!(await proves(state, until))) break; // never save a state that hasn't proved itself
      const tmp = join(opts.stateDir, `state.${process.pid}.tmp`);
      rmSync(tmp, { force: true }); // left by a hook with this pid that died
      writeFileSync(tmp, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
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
  secureDir(opts.stateDir);
  const lock = join(opts.stateDir, 'start.lock');
  const mine = `${process.pid}:${randomBytes(8).toString('hex')}`;
  while (Date.now() < until) {
    const s = readState(opts.stateDir);
    if (s && (await proves(s, until))) return s;
    // Alive and accepting connections but slow to answer: busy, not dead. Wait, don't start another.
    if (s && pidAlive(s.pid) && (await portOpen(s.url, Math.min(500, until - Date.now())))) {
      await sleep(200);
      continue;
    }
    let fd: number | null = null;
    try {
      fd = openSync(lock, 'wx');
      writeFileSync(fd, mine);
    } catch {
      // Someone else is starting it. A lock whose owner is gone was left by a hook that died.
      try {
        const owner = readFileSync(lock, 'utf8');
        const ownerPid = Number(owner.split(':')[0]);
        if (owner && !pidAlive(ownerPid) && readFileSync(lock, 'utf8') === owner) rmSync(lock, { force: true });
      } catch {
        /* gone already */
      }
      await sleep(150);
      continue;
    }
    try {
      const again = readState(opts.stateDir);
      if (again && (await proves(again, until))) return again;
      return await startEngine(opts, until);
    } finally {
      closeSync(fd);
      try {
        if (readFileSync(lock, 'utf8') === mine) rmSync(lock, { force: true });
      } catch {
        /* gone */
      }
    }
  }
  throw new Error('timed out');
}

async function ask(s: State, path: string, body: unknown, until: number): Promise<Verdict> {
  if (until - Date.now() <= 0) throw new Error('out of time');
  const res = await http(`${s.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
    body: JSON.stringify(body),
    timeoutMs: Math.max(1, until - Date.now()),
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

/** The result text Copilot will show the model, whatever shape it came in. */
function resultOf(input: Record<string, unknown>): unknown {
  let tr = input['toolResult'];
  if (typeof tr === 'string') {
    try {
      tr = JSON.parse(tr);
    } catch {
      return tr; // plain text
    }
  }
  if (tr && typeof tr === 'object') {
    const text = (tr as { textResultForLlm?: unknown }).textResultForLlm;
    return typeof text === 'string' ? text : tr; // no text field: check the whole result
  }
  if (tr !== undefined && tr !== null) return tr;
  return input['tool_response'] ?? undefined;
}

function touchesHooks(args: Record<string, unknown>): boolean {
  return PROTECTED.test(JSON.stringify(args));
}

const WRITES = /^(create|edit|str_replace_editor|apply_patch|write|multiedit|notebookedit|bash|write_bash|powershell)$/i;

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

  const result = resultOf(input);
  if (result === undefined) return replace(CANT_CHECK_RESULT); // nothing we can read: never let it through unchecked
  const v = await ask(await service(opts, until), '/v1/check/result', { tool, result: result ?? null, arguments: args, ...where }, until);
  if (v.decision === 'block') return replace(message(v));
  if (v.decision === 'redact') {
    if (v.result === undefined) return replace(message(v));
    return replace(typeof v.result === 'string' ? v.result : JSON.stringify(v.result));
  }
  return '';
}

/** What to print on stdout. Never throws, never takes longer than the deadline. */
export async function copilotHook(kind: 'pre' | 'post', stdin: string | Promise<string>, opts: HookOptions): Promise<string> {
  const failed = kind === 'pre' ? deny(CANT_CHECK_CALL) : replace(CANT_CHECK_RESULT);
  // Copilot lets a call through after 30 s: stay well inside it, whatever was configured.
  const deadline = Math.min(opts.deadlineMs ?? 20_000, 25_000);
  const until = Date.now() + deadline - 500;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<string>((ok) => {
    timer = setTimeout(() => ok(failed), deadline);
  });
  try {
    return await Promise.race([Promise.resolve(stdin).then((text) => decide(kind, text, opts, until)).catch(() => failed), late]);
  } finally {
    clearTimeout(timer);
  }
}

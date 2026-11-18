/**
 * Starting and stopping the bundled check engine for the rest of the job. It runs detached (the
 * step that starts it ends long before the job does) and the post step stops it.
 */
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const READY = /listening on (http:\/\/127\.0\.0\.1:\d+)/;

type Env = Record<string, string | undefined>;

/** dist/engine/mastyf-check.cjs next to the running script (MASTYF_ACTION_ENGINE overrides, for tests). */
export function enginePath(env: Env = process.env): string {
  return env['MASTYF_ACTION_ENGINE'] || join(dirname(process.argv[1] ?? '.'), 'engine', 'mastyf-check.cjs');
}

export function inContainer(): boolean {
  return existsSync('/.dockerenv') || existsSync('/run/.containerenv');
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lastLines(file: string, n: number): string {
  try {
    return readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-n).join('\n');
  } catch {
    return '';
  }
}

export interface StartOptions {
  engine: string;
  token: string;
  port: number;
  maxBodyMb: number;
  mode: string;
  policy?: string;
  logFile: string;
  timeoutMs?: number;
}

export async function startDetached(opts: StartOptions): Promise<{ pid: number; url: string }> {
  if (!existsSync(opts.engine)) throw new Error(`the Mastyf check engine is missing from the Action (${opts.engine})`);
  const args = [opts.engine, 'serve', '--host', '127.0.0.1', '--port', String(opts.port), '--max-body', String(opts.maxBodyMb), '--mode', opts.mode];
  if (opts.policy) args.push('--policy', opts.policy);
  // A new file only ('wx'): never write through something already at that path, such as a planted link.
  const fd = openSync(opts.logFile, 'wx', 0o600);
  let exited = false;
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: { ...process.env, MASTYF_CHECK_TOKEN: opts.token },
  });
  closeSync(fd);
  child.once('exit', () => (exited = true));
  child.once('error', () => (exited = true));
  child.unref();
  const pid = child.pid ?? 0;

  const end = Date.now() + (opts.timeoutMs ?? 60_000);
  while (Date.now() < end) {
    const m = READY.exec(lastLines(opts.logFile, 200));
    if (m) return { pid, url: m[1]! };
    if (exited) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (pid) await stopEngine(pid);
  const tail = lastLines(opts.logFile, 20);
  throw new Error(`the Mastyf check service didn't start${tail ? `:\n${tail}` : ''}`);
}

/** Checks the service on `url` knows `token` (it signs a random nonce) before anyone relies on it. */
export async function verifyHealth(url: string, token: string): Promise<void> {
  const nonce = randomBytes(16).toString('hex');
  const res = await fetch(`${url}/v1/health?nonce=${nonce}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const health = (await res.json()) as Record<string, unknown>;
  const expected = Buffer.from(createHmac('sha256', token).update(nonce).digest('hex'));
  const proof = Buffer.from(String(health['proof'] ?? ''));
  if (res.status !== 200 || proof.length !== expected.length || !timingSafeEqual(proof, expected)) {
    throw new Error("the service that answered isn't the one this Action started");
  }
}

/** Stops the engine: a polite signal, then a hard stop after 5 s. Fine if it's already gone. */
export async function stopEngine(pid: number): Promise<void> {
  if (!pidAlive(pid)) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  const end = Date.now() + 5000;
  while (pidAlive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  if (pidAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

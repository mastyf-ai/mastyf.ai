/**
 * Starting the free check engine. It ships inside @mastyf_ai/check as one JavaScript file and runs
 * on the same Node.js as your program, started with --exit-with-parent so it stops when your
 * program ends, however it ends. It never keeps your program alive.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MastyfUnavailableError } from './verdict.js';

const READY = /listening on (http:\/\/127\.0\.0\.1:\d+)/;

export interface Running {
  url: string;
  child: ChildProcess;
  alive(): boolean;
  stop(): Promise<void>;
}

/** Bun and Deno aren't supported for starting the engine yet; a configured MASTYF_CHECK_URL still works there. */
export function assertNode(): void {
  const g = globalThis as Record<string, unknown>;
  if (g['Bun'] !== undefined || g['Deno'] !== undefined) {
    throw new MastyfUnavailableError(
      "@mastyf_ai/guard starts its check engine on Node.js 20 or later; this runtime isn't supported for that yet. Set MASTYF_CHECK_URL to a check service you run instead.",
    );
  }
}

/** The engine to run: MASTYF_CHECK_BIN if set, else the bundle shipped in @mastyf_ai/check. */
export function findEngine(env: Record<string, string | undefined>): string {
  const explicit = env['MASTYF_CHECK_BIN'];
  if (explicit) return explicit;
  try {
    return createRequire(import.meta.url).resolve('@mastyf_ai/check/bundle');
  } catch {
    throw new MastyfUnavailableError('the Mastyf check engine (@mastyf_ai/check) is not installed; reinstall @mastyf_ai/guard');
  }
}

export async function startEngine(path: string, token: string, readyTimeoutMs = 60_000): Promise<Running> {
  if (!existsSync(path)) throw new MastyfUnavailableError(`the Mastyf check engine wasn't found at ${path}`);
  const isScript = /\.(c|m)?js$/.test(path);
  const command = isScript ? process.execPath : path;
  const args = [...(isScript ? [path] : []), 'serve', '--port', '0', '--exit-with-parent', '--max-body', '32'];
  const child = spawn(command, args, {
    stdio: ['pipe', 'ignore', 'pipe'],
    env: { ...process.env, MASTYF_CHECK_TOKEN: token },
    windowsHide: true,
  });

  const url = await new Promise<string | null>((resolve) => {
    let buffered = '';
    const timer = setTimeout(() => resolve(null), readyTimeoutMs);
    timer.unref();
    // Reads the engine's log for its whole life: a full pipe would stall it.
    child.stderr!.on('data', (chunk: Buffer) => {
      if (buffered === null) return;
      buffered += chunk.toString('utf8');
      const m = READY.exec(buffered);
      if (m) {
        clearTimeout(timer);
        buffered = null as unknown as string;
        resolve(m[1]!);
      } else if (buffered.length > 65_536) {
        buffered = buffered.slice(-4096);
      }
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });

  const running: Running = {
    url: url ?? '',
    child,
    alive: () => child.exitCode === null && child.signalCode === null,
    stop: async () => {
      if (!running.alive()) return;
      const exited = new Promise<void>((r) => child.once('exit', () => r()));
      child.stdin?.end(); // --exit-with-parent: closing stdin stops it
      const timer = setTimeout(() => child.kill(), 5000);
      await exited;
      clearTimeout(timer);
    },
  };
  if (!url) {
    await running.stop().catch(() => {});
    throw new MastyfUnavailableError("the Mastyf check engine didn't start");
  }
  // Neither the engine nor its pipes keep the user's program running.
  child.unref();
  (child.stdin as unknown as { unref?: () => void } | null)?.unref?.();
  (child.stderr as unknown as { unref?: () => void } | null)?.unref?.();
  child.stdin?.on('error', () => {}); // the engine exiting first must not crash the user's program
  return running;
}

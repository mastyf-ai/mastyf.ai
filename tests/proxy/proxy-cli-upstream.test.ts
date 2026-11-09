/** Runs the real `proxy` command: the policy flag must reach the dashboard, and a bad upstream must not kill it. */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const loader = pathToFileURL(path.join(repoRoot, 'node_modules/tsx/dist/loader.mjs')).href;
const cli = path.join(repoRoot, 'src/cli.ts');
const POLICY = "version: '1.0'\npolicy:\n  mode: block\n  rules: []\n";

const running: ChildProcess[] = [];
const folders: string[] = [];

function workspace(servers: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastyf-proxy-cli-'));
  folders.push(dir);
  fs.writeFileSync(path.join(dir, 'elsewhere.yaml'), POLICY);
  fs.writeFileSync(path.join(dir, 'servers.json'), JSON.stringify({ mcpServers: servers }));
  return dir;
}

function startProxy(dir: string, port: number): { child: ChildProcess; stdout: () => string } {
  const child = spawn(
    process.execPath,
    ['--import', loader, cli, 'proxy', '--config', 'servers.json', '--policy', './elsewhere.yaml'],
    {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {
        ...process.env,
        DASHBOARD_ENABLED: 'true',
        DASHBOARD_PORT: String(port),
        DASHBOARD_AUTH_DISABLED: 'true',
        METRICS_ENABLED: 'false',
        MASTYF_AI_DB_PATH: path.join(dir, 'history.db'),
        MASTYF_AI_POLICY_PATH: '',
        // Zero trust would block every call from this unverified test client.
        MASTYF_AI_AGENTIC_ENABLED: 'false',
      },
    },
  );
  running.push(child);
  let out = '';
  child.stdout?.on('data', (chunk) => {
    out += String(chunk);
  });
  return { child, stdout: () => out };
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function isUp(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
  for (const dir of folders.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Windows can hold the database open briefly after the kill.
    }
  }
});

describe('proxy command', () => {
  it('checks /api/policy/test against the --policy file, not the current folder', async () => {
    const dir = workspace({
      echo: { command: process.execPath, args: ['-e', 'process.stdin.resume()'] },
    });
    const port = 41000 + Math.floor(Math.random() * 2000);
    startProxy(dir, port);
    expect(await waitFor(() => isUp(port), 40_000)).toBe(true);

    const ask = async (filePath: string) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/policy/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'read_file', server: 'a', arguments: { path: filePath } }),
      });
      return { status: res.status, body: (await res.json()) as { action?: string } };
    };
    const blocked = await ask('/etc/passwd');
    expect(blocked.status).toBe(200);
    expect(blocked.body.action).toBe('block');
    const allowed = await ask('README.md');
    expect(allowed.status).toBe(200);
    expect(allowed.body.action).toBe('pass');
  }, 70_000);

  it('stays up and reports an error when the upstream command does not exist', async () => {
    const dir = workspace({ missing: { command: 'mastyf-no-such-command-xyz', args: [] } });
    const port = 43000 + Math.floor(Math.random() * 2000);
    const { child, stdout } = startProxy(dir, port);
    let exited = false;
    child.on('exit', () => {
      exited = true;
    });
    expect(await waitFor(() => isUp(port), 40_000)).toBe(true);

    child.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`,
    );
    await new Promise((r) => setTimeout(r, 4000));
    expect(exited).toBe(false);
    expect(await isUp(port)).toBe(true);
    expect(stdout()).not.toContain('"result"');
  }, 70_000);
});

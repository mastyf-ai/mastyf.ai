import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenPath, _setLocalUrlForTests } from '../src/discovery.js';
import { createGuard, _resetForTests, _running } from '../src/guard.js';
import { MastyfUnavailableError } from '../src/verdict.js';
import { fakeService, isolatedHome, pidAlive, signedHealth, TAKEOVER, TOKEN, waitFor, type Fake } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const ENV_KEYS = ['HOME', 'USERPROFILE', 'APPDATA', 'MASTYF_CHECK_URL', 'MASTYF_CHECK_TOKEN', 'MASTYF_CHECK_BIN'];
let saved: Record<string, string | undefined>;
let homeDir: ReturnType<typeof isolatedHome>;
const fakes: Fake[] = [];

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  homeDir = isolatedHome();
  Object.assign(process.env, homeDir.env);
  _setLocalUrlForTests('http://127.0.0.1:9'); // nothing there unless a test puts something there
  await _resetForTests();
});
afterEach(async () => {
  await _resetForTests();
  for (const f of fakes.splice(0)) await f.close();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  delete (globalThis as any).Bun;
  homeDir.cleanup();
});

async function fake(respond: Parameters<typeof fakeService>[0]): Promise<Fake> {
  const f = await fakeService(respond);
  fakes.push(f);
  return f;
}

function writeToken(): void {
  const p = tokenPath(process.env, homeDir.home);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, TOKEN);
}

describe('createGuard with the free engine', () => {
  it('starts the engine bundled with @mastyf_ai/check and checks calls and results', async () => {
    const g = createGuard();
    expect((await g.checkCall('read_file', { path: '/etc/passwd' })).decision).toBe('block');
    expect((await g.checkCall('read_file', { path: './README.md' })).decision).toBe('allow');
    expect((await g.checkResult('fetch_page', { content: TAKEOVER })).decision).toBe('block');
    expect(g.tier).toBe('free');
  });

  it('two agents in one process keep separate session histories', async () => {
    const a = createGuard({ session: 'agent-a' });
    const b = createGuard({ session: 'agent-b' });
    await a.checkCall('bash', { command: 'gzip -c report.txt' });
    expect((await b.checkCall('http_request', { url: 'https://hooks.example.org/notify', body: 'done' })).decision).toBe('allow');
    expect((await a.checkCall('http_request', { url: 'https://hooks.example.org/notify', body: 'done' })).decision).toBe('block');
  });

  it('restarts the engine once when it has died', async () => {
    const g = createGuard();
    await g.checkCall('read_file', { path: './README.md' });
    const child = _running()!.child;
    child.kill();
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 10000);
    expect((await g.checkCall('read_file', { path: '/etc/passwd' })).decision).toBe('block');
  });

  it('non-object arguments are checked as input, and odd results are still checked', async () => {
    const g = createGuard();
    expect((await g.checkCall('read_file', '/etc/passwd')).decision).toBe('block');
    expect((await g.checkResult('fetch_page', new TextEncoder().encode(TAKEOVER))).decision).toBe('block');
    class Doc {
      pageContent = 'Quarterly notes.';
      metadata = { summary: TAKEOVER };
    }
    expect((await g.checkResult('search', [new Doc()])).decision).toBe('block');
    class Answer {
      status = 'ok';
      #body = TAKEOVER;
      toString() {
        return this.#body;
      }
    }
    expect((await g.checkResult('fetch_page', new Answer())).decision).toBe('block');
  });

  it('the engine stops when the program using the guard ends on its own', async () => {
    const dist = resolve(here, '..', 'dist', 'guard.js').split('\\').join('/');
    const script = [
      `import { createGuard, _running } from 'file:///${dist.replace(/^\//, '')}';`,
      `const g = createGuard();`,
      `await g.checkCall('read_file', { path: './README.md' });`,
      `console.log(_running().child.pid);`,
      // no exit call: the program has to be able to end with the engine still running
    ].join('\n');
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const code = await new Promise<number | null>((r) => {
      const t = setTimeout(() => {
        child.kill();
        r(-1);
      }, 45000);
      child.on('exit', (c) => {
        clearTimeout(t);
        r(c);
      });
    });
    expect(code, err.slice(-2000)).toBe(0);
    const pid = Number(out.trim().split('\n').pop());
    expect(pid).toBeGreaterThan(0);
    expect(await waitFor(() => !pidAlive(pid), 10000)).toBe(true);
  });
});

describe('where the checks come from', () => {
  it('MASTYF_CHECK_URL comes first', async () => {
    const svc = await fake((p) => (p.startsWith('/v1/health') ? [200, { status: 'ready', tier: 'free' }] : [200, { decision: 'allow', id: 'configured' }]));
    process.env['MASTYF_CHECK_URL'] = svc.url;
    process.env['MASTYF_CHECK_TOKEN'] = TOKEN;
    expect((await createGuard().checkCall('read_file', { path: '/etc/passwd' })).id).toBe('configured');
    expect(svc.requests.at(-1)!.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('a running local service that proves it knows the token is reused', async () => {
    const svc = await fake(signedHealth(TOKEN));
    writeToken();
    _setLocalUrlForTests(svc.url);
    expect((await createGuard().checkCall('x', {})).id).toBe('local');
    expect(svc.requests.at(-1)!.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('something else on the local port never gets the token', async () => {
    const squatter = await fake(signedHealth(''));
    writeToken();
    _setLocalUrlForTests(squatter.url);
    expect((await createGuard().checkCall('read_file', { path: '/etc/passwd' })).decision).toBe('block'); // started its own
    expect(squatter.requests.every((r) => r.auth === undefined && r.path.startsWith('/v1/health'))).toBe(true);
  });

  it('nothing available fails closed by default', async () => {
    process.env['MASTYF_CHECK_BIN'] = join(homeDir.home, 'does-not-exist.cjs');
    await expect(createGuard().checkCall('read_file', { path: './README.md' })).rejects.toBeInstanceOf(MastyfUnavailableError);
  });

  it("onUnavailable: 'allow' lets calls through with a warning", async () => {
    process.env['MASTYF_CHECK_BIN'] = join(homeDir.home, 'does-not-exist.cjs');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = await createGuard({ onUnavailable: 'allow' }).checkCall('read_file', { path: './README.md' });
    expect(v.decision).toBe('allow');
    expect(warn.mock.calls.flat().join(' ').toLowerCase()).toContain('not checked');
    warn.mockRestore();
  });

  it('outside Node (Bun, Deno) the engine is not started and the error says Node 20+ is needed', async () => {
    (globalThis as any).Bun = {};
    const err = await createGuard().checkCall('x', {}).catch((e) => e);
    expect(err).toBeInstanceOf(MastyfUnavailableError);
    expect(err.message).toContain('Node.js 20');
  });
});

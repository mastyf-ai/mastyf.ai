/**
 * The built Action run the way a runner runs it (node dist/main.cjs, later steps, node
 * dist/post.cjs), with agents using the real libraries in between.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { fakeRunner, pidAlive, waitFor } from './fake-runner.js';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(pkg, '..', '..');
const python = process.env['MASTYF_TEST_PYTHON'];

beforeAll(() => {
  execFileSync(process.execPath, ['esbuild.mjs'], { cwd: pkg, stdio: 'pipe' });
});

function agentEnv(env: Record<string, string>): Record<string, string> {
  // A fresh home: the agent can only find the checks through what the Action exported.
  const home = mkdtempSync(join(tmpdir(), 'mastyf-agent-home-'));
  const { MASTYF_ACTION_ENGINE: _e, ...rest } = env;
  return { ...rest, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData') };
}

describe('the built Action', () => {
  it('action.yml declares the runtime, entry points, inputs and outputs', () => {
    const a = parse(readFileSync(join(pkg, 'action.yml'), 'utf8'));
    expect(a.runs).toEqual({ using: 'node24', main: 'dist/main.cjs', post: 'dist/post.cjs', 'post-if': 'always()' });
    expect(Object.keys(a.inputs).sort()).toEqual(['claude-code', 'claude-settings-base', 'fail-on-block', 'max-body-mb', 'mode', 'on-error', 'policy', 'port', 'show-reasons'].sort());
    expect(Object.fromEntries(Object.entries(a.inputs).map(([k, v]: [string, any]) => [k, v.default]))).toEqual({
      'fail-on-block': 'false',
      mode: 'block',
      policy: '',
      port: '0',
      'max-body-mb': '32',
      'show-reasons': 'false',
      'on-error': 'fail',
      'claude-code': 'false',
      'claude-settings-base': '',
    });
    expect(Object.keys(a.outputs).sort()).toEqual(['blocked-count', 'claude-settings', 'engine', 'redacted-count', 'url']);
    expect(a.branding).toEqual({ icon: 'shield', color: 'gray-dark' });
  });

  it('protects agents built with the libraries for the whole job, then reports and cleans up', async () => {
    const r = fakeRunner({ 'fail-on-block': 'true' });
    const { MASTYF_ACTION_ENGINE: _drop, ...runnerEnv } = r.env; // use the engine bundled in dist/
    const step = (script: string, env: Record<string, string>) =>
      spawnSync(process.execPath, [join(pkg, 'dist', script)], { env: { ...env, GITHUB_ACTIONS: 'true' }, encoding: 'utf8', timeout: 120_000 });

    const m = step('main.cjs', runnerEnv);
    expect(m.status, m.stdout + m.stderr).toBe(0);
    const later = agentEnv({ ...runnerEnv, ...r.read('GITHUB_ENV') });
    const pid = Number(r.read('GITHUB_STATE')['pid']);
    expect(pidAlive(pid)).toBe(true);

    // A Node agent with @mastyf_ai/guard.
    const guardDist = pathToFileURL(join(repo, 'packages', 'guard', 'dist', 'guard.js')).href;
    const nodeAgent = join(r.root, 'agent.mjs');
    writeFileSync(
      nodeAgent,
      [
        `import { createGuard, _running } from '${guardDist}';`,
        `const g = createGuard();`,
        `const a = await g.checkCall('read_file', { path: '/etc/passwd' });`,
        `const b = await g.checkCall('read_file', { path: './README.md' });`,
        `console.log(JSON.stringify({ a: a.decision, b: b.decision, tier: g.tier, started: _running() !== null }));`,
      ].join('\n'),
    );
    const n = spawnSync(process.execPath, [nodeAgent], { env: later, encoding: 'utf8', timeout: 60_000 });
    expect(n.status, n.stderr).toBe(0);
    expect(JSON.parse(n.stdout.trim().split('\n').pop()!)).toEqual({ a: 'block', b: 'allow', tier: 'free', started: false });

    let expectedBlocks = 1;
    if (python) {
      const pyAgent = join(r.root, 'agent.py');
      writeFileSync(
        pyAgent,
        [
          'import json',
          'from mastyf_ai import guard as gm',
          'from mastyf_ai.guard import Guard',
          'g = Guard()',
          "a = g.check_call('read_file', {'path': '/etc/passwd'})",
          "b = g.check_call('read_file', {'path': './README.md'})",
          "print(json.dumps({'a': a.decision, 'b': b.decision, 'tier': g.tier, 'started': gm._running() is not None}))",
        ].join('\n'),
      );
      const p = spawnSync(python, [pyAgent], { env: { ...later, PYTHONPATH: join(repo, 'packages', 'python-sdk') }, encoding: 'utf8', timeout: 60_000 });
      expect(p.status, p.stderr).toBe(0);
      expect(JSON.parse(p.stdout.trim().split('\n').pop()!)).toEqual({ a: 'block', b: 'allow', tier: 'free', started: false });
      expectedBlocks = 2;
    }

    const token = r.read('GITHUB_ENV')['MASTYF_CHECK_TOKEN']!;
    const s = step('post.cjs', r.postStep());
    expect(s.status).toBe(1); // fail-on-block
    expect(s.stdout).toContain(`Mastyf blocked ${expectedBlocks} tool call(s); see the job summary.`);
    expect(r.summary()).toContain(`${expectedBlocks} tool call${expectedBlocks === 1 ? '' : 's'} blocked`);
    expect(r.read('GITHUB_OUTPUT')['blocked-count']).toBe(String(expectedBlocks));
    expect(await waitFor(() => !pidAlive(pid), 10_000)).toBe(true);

    // The token is only in GITHUB_ENV (for later steps) and the add-mask line.
    const printed = m.stdout + m.stderr + s.stdout + s.stderr;
    expect(printed.split(token).length - 1).toBe(1);
    expect(printed).toContain(`::add-mask::${token}`);
    expect(JSON.stringify(r.read('GITHUB_OUTPUT'))).not.toContain(token);
    expect(r.summary()).not.toContain(token);
  });
});

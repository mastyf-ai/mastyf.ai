import { afterEach, describe, expect, it } from 'vitest';
import { stopEngine } from '../src/engine.js';
import { run } from '../src/main.js';
import { checkCall, fakeRunner, pidAlive, type FakeRunner } from './fake-runner.js';

const started: number[] = [];
afterEach(async () => {
  for (const pid of started.splice(0)) await stopEngine(pid);
  process.exitCode = 0;
});

function track(r: FakeRunner): void {
  const pid = Number(r.read('GITHUB_STATE')['pid']);
  if (pid) started.push(pid);
}

describe('main step', () => {
  it('starts the checks for the job and hands later steps the address and token', async () => {
    const r = fakeRunner();
    await run(r.env, { print: r.print, inContainer: () => false });
    track(r);
    expect(process.exitCode ?? 0).toBe(0);
    const exported = r.read('GITHUB_ENV');
    expect(exported['MASTYF_CHECK_URL']).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const token = exported['MASTYF_CHECK_TOKEN']!;
    expect(token.length).toBeGreaterThanOrEqual(32);
    // The token is masked before anything else could print it.
    const first = r.lines.findIndex((l) => l.includes(token));
    expect(r.lines[first]).toBe(`::add-mask::${token}`);
    expect(r.read('GITHUB_STATE')['token']).toBe(token); // for the post step; later steps can't change it
    expect(JSON.stringify(r.read('GITHUB_OUTPUT'))).not.toContain(token);
    expect(r.read('GITHUB_OUTPUT')['url']).toBe(exported['MASTYF_CHECK_URL']);
    expect(r.read('GITHUB_OUTPUT')['engine']).toMatch(/mastyf-check\.cjs$/);
    expect(r.lines.join('\n')).toContain('Mastyf checks are on for this job (free tier, on this runner).');
    expect((await checkCall(exported['MASTYF_CHECK_URL']!, token, 'read_file', { path: '/etc/passwd' })).decision).toBe('block');
  });

  it('a missing policy stops the step before anything starts', async () => {
    const r = fakeRunner({ policy: 'nope.yaml' });
    await run(r.env, { print: r.print, inContainer: () => false });
    expect(process.exitCode).toBe(1);
    expect(r.lines.join('\n')).toContain('nope.yaml');
    expect(r.read('GITHUB_ENV')).toEqual({});
    expect(r.read('GITHUB_STATE')['pid']).toBeUndefined();
  });

  it("with on-error: continue, a problem is a warning and nothing is exported", async () => {
    const r = fakeRunner({ policy: 'nope.yaml', 'on-error': 'continue' });
    await run(r.env, { print: r.print, inContainer: () => false });
    expect(process.exitCode ?? 0).toBe(0);
    expect(r.lines.some((l) => l.startsWith('::warning::'))).toBe(true);
    expect(r.read('GITHUB_ENV')).toEqual({});
    expect(r.read('GITHUB_STATE')['started']).toBe('false');
  });

  it('a second use in the same job fails clearly and leaves the first running', async () => {
    const r = fakeRunner();
    await run(r.env, { print: r.print, inContainer: () => false });
    track(r);
    const firstPid = Number(r.read('GITHUB_STATE')['pid']);
    const lines: string[] = [];
    await run(r.laterStep(), { print: (l) => lines.push(l), inContainer: () => false });
    expect(process.exitCode).toBe(1);
    expect(lines.join('\n')).toContain('already running in this job');
    expect(pidAlive(firstPid)).toBe(true);
  });

  it("container jobs aren't supported yet", async () => {
    const r = fakeRunner();
    await run(r.env, { print: r.print, inContainer: () => true });
    expect(process.exitCode).toBe(1);
    expect(r.lines.join('\n')).toContain("container jobs aren't supported yet");
    process.exitCode = 0;
    const r2 = fakeRunner({ 'on-error': 'continue' });
    await run(r2.env, { print: r2.print, inContainer: () => true });
    expect(process.exitCode ?? 0).toBe(0);
    expect(r2.lines.some((l) => l.startsWith('::warning::') && l.includes('container'))).toBe(true);
  });
});

import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { stopEngine } from '../src/engine.js';
import { run as main } from '../src/main.js';
import { run as post } from '../src/post.js';
import { checkCall, checkResult, fakeRunner, pidAlive, waitFor, type FakeRunner } from './fake-runner.js';

const SECRET = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('');
const pids: number[] = [];
afterEach(async () => {
  for (const pid of pids.splice(0)) await stopEngine(pid);
  process.exitCode = 0;
});

async function started(inputs: Record<string, string> = {}): Promise<{ r: FakeRunner; url: string; token: string; pid: number }> {
  const r = fakeRunner(inputs);
  await main(r.env, { print: r.print, inContainer: () => false });
  expect(process.exitCode ?? 0).toBe(0);
  const later = r.laterStep();
  const pid = Number(r.read('GITHUB_STATE')['pid']);
  pids.push(pid);
  return { r, url: later['MASTYF_CHECK_URL']!, token: later['MASTYF_CHECK_TOKEN']!, pid };
}

describe('post step', () => {
  it('lists blocks and hidden secrets, sets the counts, stops the checks and cleans up', async () => {
    const { r, url, token, pid } = await started();
    expect((await checkCall(url, token, 'read_file', { path: '/etc/passwd' })).decision).toBe('block');
    expect((await checkResult(url, token, 'show_config', { content: `key=${SECRET}` })).decision).toBe('redact');
    const log = r.read('GITHUB_STATE')['log']!;
    await post(r.postStep(), { print: r.print });
    expect(process.exitCode ?? 0).toBe(0);
    const md = r.summary();
    expect(md).toContain('1 tool call blocked, 1 secret hidden');
    expect(md).toContain('read_file');
    expect(md).toContain('secret hidden');
    expect(r.read('GITHUB_OUTPUT')).toMatchObject({ 'blocked-count': '1', 'redacted-count': '1' });
    expect(await waitFor(() => !pidAlive(pid), 10000)).toBe(true);
    expect(existsSync(log)).toBe(false);
    expect(r.everything()).not.toContain(SECRET);
    // The token was only ever in GITHUB_ENV (for later steps) and the mask line.
    const outside = r.everything().replace(r.read('GITHUB_ENV')['MASTYF_CHECK_TOKEN']!, '');
    expect(outside.split(`::add-mask::`).length).toBe(2);
    expect(r.summary()).not.toContain(token);
    expect(JSON.stringify(r.read('GITHUB_OUTPUT'))).not.toContain(token);
  });

  it('fail-on-block fails the job on a block, not on a hidden secret', async () => {
    const a = await started({ 'fail-on-block': 'true' });
    await checkCall(a.url, a.token, 'read_file', { path: '/etc/passwd' });
    const lines: string[] = [];
    await post(a.r.postStep(), { print: (l) => lines.push(l) });
    expect(process.exitCode).toBe(1);
    expect(lines.join('\n')).toContain('Mastyf blocked 1 tool call(s); see the job summary.');

    process.exitCode = 0;
    const b = await started({ 'fail-on-block': 'true' });
    await checkResult(b.url, b.token, 'show_config', { content: `key=${SECRET}` });
    await post(b.r.postStep(), { print: () => {} });
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('observe mode lists what would have been blocked, and fail-on-block still fails', async () => {
    const { r, url, token } = await started({ mode: 'observe', 'fail-on-block': 'true' });
    expect((await checkCall(url, token, 'read_file', { path: '/etc/passwd' })).decision).toBe('allow');
    await post(r.postStep(), { print: () => {} });
    expect(r.summary()).toContain('would block (observe mode)');
    expect(process.exitCode).toBe(1);
  });

  it('an engine that died mid-job gives a summary, not a crash; it fails the job only with fail-on-block', async () => {
    const a = await started();
    process.kill(a.pid);
    await waitFor(() => !pidAlive(a.pid), 10000);
    await post(a.r.postStep(), { print: () => {} });
    expect(a.r.summary()).toContain("wasn't reachable at the end of the job");
    expect(process.exitCode ?? 0).toBe(0);

    // With fail-on-block, "couldn't check" is never "nothing blocked": the agent could have killed it.
    const b = await started({ 'fail-on-block': 'true' });
    process.kill(b.pid);
    await waitFor(() => !pidAlive(b.pid), 10000);
    const lines: string[] = [];
    await post(b.r.postStep(), { print: (l) => lines.push(l) });
    expect(process.exitCode).toBe(1);
    expect(lines.join('\n')).toContain("couldn't confirm what was blocked");
  });

  it('a tampered token or an impostor service is never trusted', async () => {
    const { r, url, token } = await started({ 'fail-on-block': 'true' });
    await checkCall(url, token, 'read_file', { path: '/etc/passwd' });
    await post({ ...r.postStep(), MASTYF_CHECK_TOKEN: 'x'.repeat(43) }, { print: () => {} });
    expect(process.exitCode).toBe(1);
    expect(r.summary()).toContain("wasn't reachable at the end of the job");
  });

  it("when the checks never started (on-error: continue), the summary says so", async () => {
    const r = fakeRunner({ policy: 'nope.yaml', 'on-error': 'continue' });
    await main(r.env, { print: r.print, inContainer: () => false });
    await post(r.postStep(), { print: () => {} });
    expect(r.summary()).toContain("didn't start");
    expect(process.exitCode ?? 0).toBe(0);
  });
});

import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeClaudeSettings } from '../src/claude-settings.js';
import { stopEngine } from '../src/engine.js';
import { InputError, readInputs } from '../src/inputs.js';
import { run } from '../src/main.js';
import { fakeRunner } from './fake-runner.js';

const TOKEN = 't'.repeat(43);
const dir = () => mkdtempSync(join(tmpdir(), 'mastyf claude settings '));
const HOOK = join('C:\\Program Files', 'runner temp', 'claude-hook.cjs');

function entry(settings: any, event: string) {
  return settings.hooks[event].at(-1);
}

describe('writeClaudeSettings', () => {
  it('adds a fail-closed PreToolUse and PostToolUse hook for every tool', () => {
    const d = dir();
    const out = writeClaudeSettings({ dir: d, hookPath: HOOK, url: 'http://127.0.0.1:4100', token: TOKEN });
    const s = JSON.parse(readFileSync(out.settings, 'utf8'));
    for (const event of ['PreToolUse', 'PostToolUse']) {
      const e = entry(s, event);
      expect(e.matcher).toBe('*');
      expect(e.hooks).toEqual([{ type: 'command', command: `node "${HOOK}" "http://127.0.0.1:4100" "${TOKEN}"`, timeout: 30, onFailure: 'block' }]);
    }
  });

  it('writes no config file the agent could edit later: address and token are in the hook command', () => {
    const d = dir();
    const out = writeClaudeSettings({ dir: d, hookPath: HOOK, url: 'http://127.0.0.1:4100', token: TOKEN });
    expect(Object.keys(out)).toEqual(['settings']);
    if (process.platform !== 'win32') expect(statSync(out.settings).mode & 0o077).toBe(0);
  });

  it('refuses a base file that would switch hooks off', () => {
    const d = dir();
    for (const bad of [{ disableAllHooks: true }, { allowManagedHooksOnly: true }]) {
      const base = join(d, 'off.json');
      writeFileSync(base, JSON.stringify(bad));
      expect(() => writeClaudeSettings({ dir: d, hookPath: HOOK, url: 'http://127.0.0.1:4100', token: TOKEN, base })).toThrow(/switch.*hooks off|hooks off/);
    }
  });

  it("merges a base file: its keys and its own hooks are kept, ours added after", () => {
    const d = dir();
    const base = join(d, 'base.json');
    const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo theirs' }] };
    writeFileSync(base, JSON.stringify({ model: 'claude-opus-5', env: { CI: 'true' }, permissions: { deny: ['WebFetch'] }, hooks: { PreToolUse: [theirs], Stop: [{ hooks: [] }] } }));
    const out = writeClaudeSettings({ dir: d, hookPath: HOOK, url: 'http://127.0.0.1:4100', token: TOKEN, base });
    const s = JSON.parse(readFileSync(out.settings, 'utf8'));
    expect(s.model).toBe('claude-opus-5');
    expect(s.env).toEqual({ CI: 'true' });
    expect(s.permissions).toEqual({ deny: ['WebFetch'] });
    expect(s.hooks.Stop).toEqual([{ hooks: [] }]);
    expect(s.hooks.PreToolUse[0]).toEqual(theirs);
    expect(s.hooks.PreToolUse).toHaveLength(2);
    expect(s.hooks.PostToolUse).toHaveLength(1);
  });

  it('a base file that is not JSON is an error naming it', () => {
    const d = dir();
    const base = join(d, 'broken.json');
    writeFileSync(base, '{ nope');
    expect(() => writeClaudeSettings({ dir: d, hookPath: HOOK, url: 'u', token: TOKEN, base })).toThrow(/broken\.json/);
  });
});

describe('inputs', () => {
  it('claude-code is off by default; a base outside the workspace is rejected', () => {
    const ws = dir();
    expect(readInputs({}, ws)).toMatchObject({ claudeCode: false, claudeSettingsBase: undefined });
    expect(readInputs({ 'INPUT_CLAUDE-CODE': 'true' }, ws).claudeCode).toBe(true);
    expect(() => readInputs({ 'INPUT_CLAUDE-SETTINGS-BASE': '../x.json' }, ws)).toThrow(InputError);
  });
});

describe('main with claude-code: true', () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it('writes the settings and outputs their path', async () => {
    const r = fakeRunner({ 'claude-code': 'true' });
    await run(r.env, { print: r.print, inContainer: () => false });
    const pid = Number(r.read('GITHUB_STATE')['pid']);
    try {
      expect(process.exitCode ?? 0).toBe(0);
      const path = r.read('GITHUB_OUTPUT')['claude-settings']!;
      const s = JSON.parse(readFileSync(path, 'utf8'));
      expect(entry(s, 'PreToolUse').hooks[0].command).toContain('claude-hook.cjs');
    } finally {
      await stopEngine(pid);
    }
  });

  it('a broken base file stops the step, naming it', async () => {
    const r = fakeRunner({ 'claude-code': 'true', 'claude-settings-base': '.claude/ci.json' });
    mkdirSync(join(r.env['GITHUB_WORKSPACE']!, '.claude'));
    writeFileSync(join(r.env['GITHUB_WORKSPACE']!, '.claude', 'ci.json'), '{ nope');
    await run(r.env, { print: r.print, inContainer: () => false });
    expect(process.exitCode).toBe(1);
    expect(r.lines.join('\n')).toContain('ci.json');
    expect(r.read('GITHUB_STATE')['pid']).toBeUndefined(); // nothing left running
  });
});

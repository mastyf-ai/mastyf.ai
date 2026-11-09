import { describe, it, expect } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { spawnUpstream } from '../../src/utils/spawn-upstream.js';

function finish(child: ChildProcess): Promise<{ code: number | null; stdout: string; error?: NodeJS.ErrnoException }> {
  return new Promise((resolve) => {
    let stdout = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.on('error', (error) => resolve({ code: null, stdout, error }));
    child.on('close', (code) => resolve({ code, stdout }));
  });
}

describe('spawnUpstream', () => {
  it('starts a command that is a .cmd shim on Windows, such as npx', async () => {
    const child = spawnUpstream('npx', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const result = await finish(child);
    expect(result.error).toBeUndefined();
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+/);
  }, 60_000);

  it('passes arguments through untouched, so a shell cannot interpret them', async () => {
    const tricky = ['a b', 'c&echo injected', '"quoted"', '%PATH%', '$(whoami)', 'x|y'];
    const child = spawnUpstream(
      process.execPath,
      ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...tricky],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const result = await finish(child);
    expect(JSON.parse(result.stdout)).toEqual(tricky);
  }, 30_000);

  it('passes arguments through a .cmd shim untouched', async () => {
    const tricky = ['c&echo injected', 'a b'];
    const child = spawnUpstream(
      'npx',
      ['--no-install', '--yes', 'node', '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...tricky],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const result = await finish(child);
    expect(result.stdout).not.toContain('injected\r');
    expect(JSON.parse(result.stdout)).toEqual(tricky);
  }, 60_000);

  it('reports a missing command as an error event, not a thrown exception', async () => {
    const child = spawnUpstream('mastyf-no-such-command-xyz', [], { stdio: ['ignore', 'pipe', 'ignore'] });
    const result = await finish(child);
    if (result.error) {
      expect(result.error.code).toBe('ENOENT');
    } else {
      expect(result.code).not.toBe(0);
    }
  }, 30_000);
});

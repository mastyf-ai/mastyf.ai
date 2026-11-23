import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs module without type declarations
import { windowsSpawnPlan } from '../../security-swarm/lib/run-step.mjs';

describe('swarm step spawning', () => {
  it('runs pnpm through its own entry script when launched by pnpm (no shell, no PATH lookup)', () => {
    const plan = windowsSpawnPlan('pnpm', ['build'], 'win32', { npm_execpath: 'C:/tools/pnpm/bin/pnpm.cjs' });
    expect(plan).toEqual({ cmd: process.execPath, args: ['C:/tools/pnpm/bin/pnpm.cjs', 'build'], shell: false });
  });

  it('uses one quoted command line through the shell for .cmd shims on Windows', () => {
    expect(windowsSpawnPlan('npx', ['tsx', 'a b.ts'], 'win32', {})).toEqual({ cmd: 'npx tsx "a b.ts"', args: [], shell: true });
  });

  it('leaves node and every command on other platforms alone', () => {
    expect(windowsSpawnPlan('node', ['x.mjs'], 'win32', {})).toEqual({ cmd: 'node', args: ['x.mjs'], shell: false });
    expect(windowsSpawnPlan('pnpm', ['build'], 'linux', {})).toEqual({ cmd: 'pnpm', args: ['build'], shell: false });
  });
});

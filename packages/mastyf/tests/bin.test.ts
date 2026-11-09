import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { run } = require('../bin.cjs') as {
  run: (
    argv: string[],
    deps: { cliPath: string; execPath: string; spawnSync: (cmd: string, args: string[], opts: { stdio: string }) => { status: number | null } },
  ) => number;
};

describe('mastyf command', () => {
  it('forwards its arguments to the server CLI and returns its exit code', () => {
    const spawnSync = vi.fn(() => ({ status: 3 }));
    const code = run(['connect', '--key', 'k'], { cliPath: '/pkg/dist/cli.js', execPath: '/abs/node', spawnSync });
    expect(code).toBe(3);
    expect(spawnSync).toHaveBeenCalledWith('/abs/node', ['/pkg/dist/cli.js', 'connect', '--key', 'k'], { stdio: 'inherit' });
  });

  it('reports failure when the CLI could not start', () => {
    expect(run([], { cliPath: 'x', execPath: 'y', spawnSync: () => ({ status: null }) })).toBe(1);
  });
});

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = join(__dirname, '..');
const nodeRequire = createRequire(__filename);

describe('the packaged bundle', () => {
  it('loads with only `vscode` and Node built-ins available (everything else must be bundled)', () => {
    execFileSync(process.execPath, ['esbuild.mjs'], { cwd: pkg, stdio: 'ignore' });
    const code = readFileSync(join(pkg, 'dist', 'extension.js'), 'utf8');
    const required: string[] = [];
    const fakeRequire = (id: string) => {
      required.push(id);
      if (id === 'vscode') return {};
      if (id.startsWith('node:') || nodeRequire('node:module').builtinModules.includes(id)) return nodeRequire(id);
      throw new Error(`Cannot find module '${id}' (not bundled)`);
    };
    const mod = { exports: {} as Record<string, unknown> };
    new Function('require', 'module', 'exports', '__filename', '__dirname', code)(fakeRequire, mod, mod.exports, 'extension.js', pkg);
    expect(typeof mod.exports.activate).toBe('function');
    expect(required.filter((id) => id !== 'vscode' && !id.startsWith('node:') && !nodeRequire('node:module').builtinModules.includes(id))).toEqual([]);
  });
});

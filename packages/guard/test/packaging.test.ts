import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('what npm installs', () => {
  it('ships only the build, README, LICENSE and package.json', () => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const out = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: pkgDir, encoding: 'utf8', shell: process.platform === 'win32' });
    const files: string[] = JSON.parse(out)[0].files.map((f: { path: string }) => f.path.split('\\').join('/'));
    expect(files).toContain('README.md');
    expect(files).toContain('LICENSE');
    expect(files).toContain('package.json');
    expect(files).toContain('dist/index.js');
    for (const sub of ['mastra', 'langchain', 'openai-agents']) expect(files).toContain(`dist/${sub}.js`);
    expect(files.filter((f) => !f.startsWith('dist/') && !['README.md', 'LICENSE', 'package.json'].includes(f))).toEqual([]);
  });

  it('is MIT and depends on the check engine', () => {
    const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));
    expect(pkg.license).toBe('MIT');
    expect(pkg.dependencies['@mastyf_ai/check']).toBeDefined();
    expect(Object.keys(pkg.exports)).toEqual(['.', './mastra', './langchain', './openai-agents']);
  });
});

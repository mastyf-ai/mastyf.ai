import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(pkg, 'dist', 'mastyf-check.cjs');

beforeAll(() => {
  execFileSync(process.execPath, ['esbuild.mjs'], { cwd: pkg, stdio: 'pipe' });
}, 180_000);

const repo = () => mkdtempSync(join(tmpdir(), 'mastyf-init-copilot-'));
const init = (dir: string, ...extra: string[]) => spawnSync(process.execPath, [BUNDLE, 'init-copilot', '--dir', dir, ...extra], { encoding: 'utf8', timeout: 60_000 });

const EXPECTED = {
  version: 1,
  hooks: {
    preToolUse: [{ type: 'command', bash: 'node .github/hooks/mastyf/mastyf-check.cjs copilot-hook pre', timeoutSec: 30 }],
    postToolUse: [{ type: 'command', bash: 'node .github/hooks/mastyf/mastyf-check.cjs copilot-hook post', timeoutSec: 30 }],
  },
};

describe('init-copilot', () => {
  it('writes the hook config and the self-contained hook folder, and says what to commit', () => {
    const d = repo();
    const r = init(d);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(d, '.github', 'hooks', 'mastyf.json'), 'utf8'))).toEqual(EXPECTED);
    const folder = join(d, '.github', 'hooks', 'mastyf');
    expect(readFileSync(join(folder, 'mastyf-check.cjs'))).toEqual(readFileSync(BUNDLE));
    expect(readFileSync(join(folder, 'LICENSE'), 'utf8')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(readFileSync(join(folder, 'README.md'), 'utf8')).toContain('copilot-hook');
    expect(r.stdout).toContain('.github/hooks/mastyf.json');
    expect(r.stdout).toContain('.github/hooks/mastyf/');
    expect(r.stdout).toMatch(/commit/i);
  });

  it('running it again is fine; a different mastyf.json is not overwritten without --force', () => {
    const d = repo();
    expect(init(d).status).toBe(0);
    expect(init(d).status).toBe(0); // identical files
    writeFileSync(join(d, '.github', 'hooks', 'mastyf.json'), '{"version":1,"hooks":{}}');
    const r = init(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('mastyf.json');
    expect(r.stderr).toContain('--force');
    expect(readFileSync(join(d, '.github', 'hooks', 'mastyf.json'), 'utf8')).toBe('{"version":1,"hooks":{}}');
    expect(init(d, '--force').status).toBe(0);
    expect(JSON.parse(readFileSync(join(d, '.github', 'hooks', 'mastyf.json'), 'utf8'))).toEqual(EXPECTED);
  });

  it("leaves the repository's other hook files alone", () => {
    const d = repo();
    mkdirSync(join(d, '.github', 'hooks'), { recursive: true });
    writeFileSync(join(d, '.github', 'hooks', 'audit.json'), '{"version":1,"hooks":{}}');
    expect(init(d).status).toBe(0);
    expect(readFileSync(join(d, '.github', 'hooks', 'audit.json'), 'utf8')).toBe('{"version":1,"hooks":{}}');
    expect(existsSync(join(d, '.github', 'hooks', 'mastyf.json'))).toBe(true);
  });

  it('a directory that does not exist is an error', () => {
    const r = init(join(repo(), 'nope'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('nope');
  });
});

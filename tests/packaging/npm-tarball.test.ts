import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
let files: string[] = [];

beforeAll(() => {
  const out = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
  files = (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path.split(path.sep).join('/'));
}, 180_000);

describe('the published npm package', () => {
  it('ships what a fresh install needs', () => {
    for (const f of ['dist/cli.js', 'default-policy.yaml', 'scripts/mastyf-ai-proxy.sh', 'scripts/mastyf-ai-proxy.ps1']) {
      expect(files).toContain(f);
    }
  });

  it('lets the mastyf command find the CLI through the exports map', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
    expect(pkg.exports['./cli']).toBe('./dist/cli.js');
    expect(fs.readFileSync(path.join(ROOT, 'packages/mastyf/bin.cjs'), 'utf8')).toContain("require.resolve('@mastyf_ai/server/cli')");
  });

  it('ships nothing on the pack denylist', () => {
    const denied = new RegExp(process.env.MASTYF_PACK_DENYLIST || '^$', 'i');
    expect(files.filter((f) => denied.test(f))).toEqual([]);
  });
});

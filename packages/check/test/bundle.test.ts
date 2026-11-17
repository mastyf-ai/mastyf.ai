import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const PKG = join(__dirname, '..');
const BUNDLE = join(PKG, 'dist', 'mastyf-check.cjs');
let text = '';
let alone = '';

beforeAll(() => {
  execFileSync(process.execPath, ['esbuild.mjs'], { cwd: PKG, stdio: 'pipe' });
  text = readFileSync(BUNDLE, 'utf8');
  // A folder with nothing but the bundle: proves it needs no node_modules and no repo files.
  const dir = mkdtempSync(join(tmpdir(), 'mastyf-check-bundle-'));
  alone = join(dir, 'mastyf-check.cjs');
  copyFileSync(BUNDLE, alone);
}, 180000);

describe('the bundle', () => {
  it('contains no paid layer, licence client or extension loader', () => {
    for (const word of ['protocol-x', 'causal-gate', 'ai-review', 'difc/taint', 'globalSessionTaintTracker', 'src/license/license-client', 'src/proxy/semantic-proxy-hooks', 'enqueueSemanticAudit', 'src/agentic/', 'src/extensions/index', 'MASTYF_AI_EXTENSIONS', 'mastyf-enterprise']) {
      expect({ word, found: text.includes(word) }).toEqual({ word, found: false });
    }
  });

  it('runs alone (no node_modules, no repo) and blocks a sensitive read', () => {
    let code = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [alone, 'test', 'read_file', '{"path":"/etc/passwd"}'], { encoding: 'utf8', env: { ...process.env, MASTYF_CHECK_TOKEN: 'k'.repeat(43) } });
    } catch (err) {
      code = (err as { status: number }).status;
      out = String((err as { stdout: string }).stdout);
    }
    expect(code).toBe(2);
    expect(out).toContain('"decision": "block"');
  });

  it('serves /v1/health on its own', async () => {
    const port = 41000 + Math.floor(Math.random() * 2000);
    const child = spawn(process.execPath, [alone, 'serve', '--port', String(port)], {
      env: { ...process.env, MASTYF_CHECK_TOKEN: 'k'.repeat(43) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    try {
      let health: any = null;
      for (let i = 0; i < 100 && !health; i++) {
        await new Promise((r) => setTimeout(r, 100));
        health = await fetch(`http://127.0.0.1:${port}/v1/health`).then((r) => r.json()).catch(() => null);
      }
      expect(health).toMatchObject({ status: 'ready', tier: 'free' });
    } finally {
      child.kill();
    }
  }, 30000);
});

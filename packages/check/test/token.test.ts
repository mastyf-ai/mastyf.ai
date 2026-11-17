import { mkdtempSync, readFileSync, statSync, lstatSync, symlinkSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureToken, tokenPath } from '../src/token';

const home = () => mkdtempSync(join(tmpdir(), 'mastyf-check-token-'));

describe('ensureToken', () => {
  it('creates a long random token the first time and reuses it after', () => {
    const h = home();
    const a = ensureToken({ env: {}, home: h, platform: process.platform });
    expect(a).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(ensureToken({ env: {}, home: h, platform: process.platform })).toBe(a);
    expect(readFileSync(tokenPath({ env: {}, home: h, platform: process.platform }), 'utf8').trim()).toBe(a);
  });

  it('MASTYF_CHECK_TOKEN wins and nothing is written', () => {
    const h = home();
    const t = 'x'.repeat(40);
    expect(ensureToken({ env: { MASTYF_CHECK_TOKEN: t }, home: h, platform: process.platform })).toBe(t);
  });

  it('refuses a MASTYF_CHECK_TOKEN that is too short to be safe', () => {
    expect(() => ensureToken({ env: { MASTYF_CHECK_TOKEN: 'short' }, home: home(), platform: process.platform })).toThrow(/at least 32/);
  });

  it('replaces an empty or too-short token file instead of accepting it', () => {
    const h = home();
    const p = tokenPath({ env: {}, home: h, platform: process.platform });
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, '');
    const t = ensureToken({ env: {}, home: h, platform: process.platform });
    expect(t.length).toBeGreaterThanOrEqual(43);
    writeFileSync(p, 'abc');
    expect(ensureToken({ env: {}, home: h, platform: process.platform })).not.toBe('abc');
  });

  it.skipIf(process.platform === 'win32')('on Mac and Linux, the file is readable by its owner only, and a world-readable one is replaced', () => {
    const h = home();
    const opts = { env: {}, home: h, platform: process.platform };
    const first = ensureToken(opts);
    const p = tokenPath(opts);
    expect(statSync(p).mode & 0o077).toBe(0);
    chmodSync(p, 0o644);
    const second = ensureToken(opts);
    expect(second).not.toBe(first);
    expect(statSync(p).mode & 0o077).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('the folder is owner-only, and a link planted at the token path is replaced, not followed', () => {
    const h = home();
    const opts = { env: {}, home: h, platform: process.platform };
    const p = tokenPath(opts);
    mkdirSync(join(p, '..'), { recursive: true, mode: 0o755 });
    const target = join(h, 'elsewhere.txt');
    writeFileSync(target, 'untouched');
    symlinkSync(target, p);
    const t = ensureToken(opts);
    expect(readFileSync(target, 'utf8')).toBe('untouched');
    expect(lstatSync(p).isSymbolicLink()).toBe(false);
    expect(readFileSync(p, 'utf8').trim()).toBe(t);
    expect(statSync(join(p, '..')).mode & 0o077).toBe(0);
  });

  it('the token file lives under ~/.mastyf/check (or %APPDATA%\\Mastyf\\check on Windows)', () => {
    expect(tokenPath({ env: {}, home: '/home/u', platform: 'linux' }).replace(/\\/g, '/')).toBe('/home/u/.mastyf/check/token');
    expect(tokenPath({ env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, home: 'C:\\Users\\u', platform: 'win32' })).toBe(
      'C:\\Users\\u\\AppData\\Roaming\\Mastyf\\check\\token',
    );
  });
});

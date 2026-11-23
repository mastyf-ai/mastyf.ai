import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, parse } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSensitivePathGuard } from '../../src/policy/tool-call-hooks.js';
import { BUILTIN_DENIED_PATHS, defaultAllowedPaths } from '../../src/policy/workspace-path-guard.js';

const WIN = ['C:\\Users\\dev\\work/*'];
const call = async (allowed: string[], args: Record<string, unknown>) =>
  (await createSensitivePathGuard(allowed, BUILTIN_DENIED_PATHS).beforeToolCall({ tool: { name: 't', arguments: args } } as never)).allowed;

describe('path guard: Windows paths', () => {
  it('allows files in the named folder with either slash and any case', async () => {
    for (const path of ['C:\\Users\\dev\\work\\a.txt', 'C:/Users/dev/work/a.txt', 'c:\\users\\DEV\\work\\a.txt', 'C:\\Users\\dev\\work']) {
      expect(await call(WIN, { path }), path).toBe(true);
    }
  });

  it.each([
    'C:\\Users\\dev\\work\\.ssh\\id_rsa',
    'C:\\Users\\dev\\work\\.SSH\\config',
    'C:\\Users\\dev\\work\\.ssh.\\config',
    'C:\\Users\\dev\\work\\.aws\\credentials',
    'C:\\Users\\dev\\work\\app\\.ENV',
    'C:\\Users\\dev\\work\\app\\.env.local',
    'C:\\Users\\dev\\work\\.mastyf\\dashboard_api_key',
    'C:\\Users\\dev\\work\\server.pem',
  ])('refuses secrets inside the folder: %s', async (path) => {
    expect(await call(WIN, { path })).toBe(false);
  });

  it.each([
    'C:\\Users\\dev\\work\\..\\..\\..\\Windows\\win.ini',
    'C:/Users/dev/work/../secret.txt',
    'C:\\Users\\dev\\workshop\\a.txt',
    'C:\\Users\\dev\\other.txt',
    '\\\\?\\C:\\Users\\dev\\work\\a.txt',
    '\\\\host\\share\\a.txt',
    'C:\\Users\\dev\\work\\a.txt:stream',
    'a.txt',
    '~/work/a.txt',
  ])('refuses paths outside the folder: %s', async (path) => {
    expect(await call(WIN, { path })).toBe(false);
  });

  it('does not mistake ordinary names for secrets', async () => {
    expect(await call(WIN, { path: 'C:\\Users\\dev\\work\\monkey.txt' })).toBe(true);
    expect(await call(WIN, { path: 'C:\\Users\\dev\\work\\environment.md' })).toBe(true);
  });
});

describe('path guard: every path argument', () => {
  const bad = 'C:\\Windows\\win.ini';
  it('checks paths, file_path and path-like destinations', async () => {
    expect(await call(WIN, { paths: ['C:\\Users\\dev\\work\\a.txt', bad] })).toBe(false);
    expect(await call(WIN, { paths: [{ $gt: '' }] })).toBe(false);
    expect(await call(WIN, { file_path: bad })).toBe(false);
    expect(await call(WIN, { destination: bad })).toBe(false);
    expect(await call(WIN, { destination: 'Lisbon' })).toBe(true);
  });
});

describe('path guard: POSIX paths', () => {
  const allowed = ['/tmp/*', '/workspace/*'];
  it('anchors the allow list and refuses traversal', async () => {
    expect(await call(allowed, { path: '/workspace/a.ts' })).toBe(true);
    expect(await call(allowed, { path: '/etc/tmp/x' })).toBe(false);
    expect(await call(allowed, { path: '/tmp/../etc/passwd' })).toBe(false);
    expect(await call(allowed, { path: '//tmp/x' })).toBe(false);
  });
});

describe('defaultAllowedPaths', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'mastyf-paths-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('adds only folders named in a local server, never home or a drive root', async () => {
    const list = defaultAllowedPaths(
      [
        { name: 'a', transport: 'stdio', args: ['index.js', dir, join(dir, 'missing'), parse(dir).root] },
        { name: 'b', transport: 'sse', args: [homedir()] },
      ],
      {},
    );
    expect(list).toEqual(['/home/*', '/tmp/*', '/workspace/*', '/app/*', `${dir}/*`]);
    expect(await call(list, { path: join(dir, 'new-file.txt') })).toBe(true);
    expect(await call(list, { path: join(homedir(), 'unlisted-mastyf.txt') })).toBe(homedir().startsWith('/home/'));
  });

  it('refuses a link that leads out of an allowed folder', async () => {
    const inside = join(dir, 'inside');
    const outside = join(dir, 'outside');
    mkdirSync(inside);
    mkdirSync(outside);
    writeFileSync(join(outside, 's.txt'), 'x');
    symlinkSync(outside, join(inside, 'link'), 'junction');
    expect(await call([`${inside}/*`], { path: join(inside, 'link', 's.txt') })).toBe(false);
    expect(await call([`${inside}/*`], { path: join(inside, 'ok.txt') })).toBe(true);
  });

  it('uses MASTYF_AI_ALLOWED_PATHS instead when set', () => {
    expect(defaultAllowedPaths([], { MASTYF_AI_ALLOWED_PATHS: '/data/*, /srv/*' })).toEqual(['/data/*', '/srv/*']);
  });
});

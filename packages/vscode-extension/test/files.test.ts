import { describe, expect, it } from 'vitest';
import { makeFileAccess, safePollSeconds, safePort, type FsOps } from '../src/files';

type Entry = { link?: string; size?: number; dir?: boolean; mtimeMs?: number; text?: string };

/** A fake file system that records every path the code touches beyond lstat/readlink. */
function fakeFs(entries: Record<string, Entry>) {
  const followed: string[] = [];
  // A path that is a parent of a listed path is a folder.
  const isParent = (p: string) => Object.keys(entries).some((k) => k.toLowerCase().startsWith(`${p.toLowerCase()}\\`));
  const ops: FsOps = {
    lstat: (p) => {
      const e = entries[p] ?? (isParent(p) ? { dir: true } : undefined);
      if (!e) throw new Error('ENOENT');
      return { isSymbolicLink: () => Boolean(e.link), isFile: () => !e.link && !e.dir, size: e.size ?? 10, mtimeMs: e.mtimeMs ?? 1 };
    },
    readlink: (p) => entries[p].link as string,
    stat: (p) => {
      followed.push(p);
      const e = entries[p];
      if (!e) throw new Error('ENOENT');
      return { isFile: () => !e.dir, size: e.size ?? 10, mtimeMs: e.mtimeMs ?? 1 };
    },
    readFile: (p) => {
      followed.push(p);
      return entries[p]?.text ?? '';
    },
  };
  return { ops, followed };
}

describe('makeFileAccess', () => {
  it('reads a small local file', () => {
    const { ops } = fakeFs({ 'C:\\a\\mcp.json': { text: '{}', mtimeMs: 5 } });
    const f = makeFileAccess(ops);
    expect(f.readSmallFile('C:\\a\\mcp.json')).toBe('{}');
    expect(f.mtimeOf('C:\\a\\mcp.json')).toBe(5);
  });

  it('never follows a link that points at a network share, not even to stat it', () => {
    const { ops, followed } = fakeFs({ 'C:\\repo\\.vscode\\mcp.json': { link: '\\\\evil.example\\share\\x.json' } });
    const f = makeFileAccess(ops);
    expect(() => f.readSmallFile('C:\\repo\\.vscode\\mcp.json')).toThrow();
    expect(f.mtimeOf('C:\\repo\\.vscode\\mcp.json')).toBeNull();
    expect(followed).toEqual([]);
  });

  it('follows a link to a local drive (dotfile setups)', () => {
    const { ops } = fakeFs({
      'C:\\Users\\u\\.claude.json': { link: 'D:\\dotfiles\\claude.json' },
      'D:\\dotfiles\\claude.json': { text: '{"a":1}', mtimeMs: 9 },
    });
    const f = makeFileAccess(ops);
    expect(f.readSmallFile('C:\\Users\\u\\.claude.json')).toBe('{"a":1}');
    expect(f.mtimeOf('C:\\Users\\u\\.claude.json')).toBe(9);
  });

  it('resolves a relative link target against the link folder', () => {
    const { ops } = fakeFs({
      'C:\\repo\\.vscode\\mcp.json': { link: '..\\shared\\mcp.json' },
      'C:\\repo\\shared\\mcp.json': { text: '{}' },
    });
    expect(makeFileAccess(ops).readSmallFile('C:\\repo\\.vscode\\mcp.json')).toBe('{}');
  });

  it('never goes through a linked folder that points at a network share', () => {
    const touched: string[] = [];
    const { ops, followed } = fakeFs({
      'C:\\repo': { dir: true },
      'C:\\repo\\.vscode': { link: '\\\\evil.example\\share' },
    });
    const lstat = ops.lstat;
    ops.lstat = (p) => {
      touched.push(p);
      return lstat(p);
    };
    const f = makeFileAccess(ops);
    expect(() => f.readSmallFile('C:\\repo\\.vscode\\mcp.json')).toThrow();
    expect(f.mtimeOf('C:\\repo\\.vscode\\mcp.json')).toBeNull();
    expect(touched).not.toContain('C:\\repo\\.vscode\\mcp.json');
    expect([...touched, ...followed].filter((p) => p.startsWith('\\\\'))).toEqual([]);
  });

  it('follows a linked folder that points at a local drive', () => {
    const { ops } = fakeFs({
      'C:\\repo': { dir: true },
      'C:\\repo\\.vscode': { link: 'D:\\shared\\vscode' },
      'D:\\shared': { dir: true },
      'D:\\shared\\vscode': { dir: true },
      'D:\\shared\\vscode\\mcp.json': { text: '{"servers":{}}' },
    });
    expect(makeFileAccess(ops).readSmallFile('C:\\repo\\.vscode\\mcp.json')).toBe('{"servers":{}}');
  });

  it('refuses a link to a link (one hop only), a directory, a huge file, and a network path itself', () => {
    const { ops, followed } = fakeFs({
      'C:\\a': { link: 'C:\\b' },
      'C:\\b': { link: '\\\\evil\\x' },
      'C:\\dir': { dir: true },
      'C:\\big': { size: 40 * 1024 * 1024 },
    });
    const f = makeFileAccess(ops);
    expect(() => f.readSmallFile('C:\\a')).toThrow();
    expect(() => f.readSmallFile('C:\\dir')).toThrow();
    expect(() => f.readSmallFile('C:\\big')).toThrow();
    expect(() => f.readSmallFile('\\\\evil\\share\\x')).toThrow();
    expect(followed.filter((p) => p.startsWith('\\\\'))).toEqual([]);
  });
});

describe('settings values', () => {
  it('port: a whole number from 1 to 65535, else 14000', () => {
    expect(safePort(14000)).toBe(14000);
    expect(safePort(18000)).toBe(18000);
    for (const bad of [0, -1, 70000, 1.5, Number.NaN, '14000', null, undefined]) expect(safePort(bad)).toBe(14000);
  });

  it('poll seconds: at least 5, a finite number, else 15', () => {
    expect(safePollSeconds(30)).toBe(30);
    expect(safePollSeconds(1)).toBe(5);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '10', null, undefined]) expect(safePollSeconds(bad)).toBe(15);
  });
});

describe('size limit', () => {
  it("reads a large ~/.claude.json (heavy Claude Code users pass 1 MB)", () => {
    const { ops } = fakeFs({ 'C:\\Users\\u\\.claude.json': { size: 6 * 1024 * 1024, text: '{}' } });
    expect(makeFileAccess(ops).readSmallFile('C:\\Users\\u\\.claude.json')).toBe('{}');
  });
});

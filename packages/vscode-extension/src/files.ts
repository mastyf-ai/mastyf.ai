/**
 * File access for paths that can come from a cloned repository, and checks on settings values.
 * Touching a network path on Windows (\\host\share) sends the user's login hash to that host, so
 * nothing here opens, stats or follows anything that isn't on a local drive, links included.
 */
import { win32 as path } from 'node:path';
import { isLocalDrivePath } from './settings';

export interface FsOps {
  lstat(p: string): { isSymbolicLink(): boolean; isFile(): boolean; size: number; mtimeMs: number };
  readlink(p: string): string;
  stat(p: string): { isFile(): boolean; size: number; mtimeMs: number };
  readFile(p: string): string;
}

/** Large enough for a heavy Claude Code user's ~/.claude.json (it keeps project history), small enough to refuse junk. */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

const MAX_LINK_HOPS = 8;

/**
 * The local path to actually read. Walks the path one folder at a time from the drive root with
 * lstat, which never follows a link, so a linked folder (`.vscode` → `\\host\share`) is caught
 * before anything goes through it. A link to a local drive is followed by rewriting the path;
 * anything else throws.
 */
function localTarget(fs: FsOps, p: string, hops = 0): string {
  if (!isLocalDrivePath(p)) throw new Error('not a local drive path');
  const parts = path.normalize(p).split('\\').filter(Boolean);
  let current = `${parts[0]}\\`;
  for (let i = 1; i < parts.length; i++) {
    const next = path.join(current, parts[i]);
    if (fs.lstat(next).isSymbolicLink()) {
      if (hops >= MAX_LINK_HOPS) throw new Error('too many links');
      // readlink reads the link itself; the target is checked before anything touches it.
      const target = path.resolve(path.dirname(next), fs.readlink(next));
      if (!isLocalDrivePath(target)) throw new Error('link to a non-local path');
      return localTarget(fs, path.join(target, ...parts.slice(i + 1)), hops + 1);
    }
    current = next;
  }
  return current;
}

export function makeFileAccess(fs: FsOps) {
  const readSmallFile = (p: string): string => {
    const target = localTarget(fs, p);
    const st = fs.stat(target);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) throw new Error('not a small regular file');
    return fs.readFile(target);
  };
  const mtimeOf = (p: string): number | null => {
    try {
      return fs.stat(localTarget(fs, p)).mtimeMs;
    } catch {
      return null;
    }
  };
  return { readSmallFile, mtimeOf };
}

/** The Shield port setting: a whole number from 1 to 65535, otherwise Shield's default. */
export function safePort(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536 ? value : 14000;
}

/** The poll interval setting: a finite number of seconds, at least 5, otherwise 15. */
export function safePollSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(5, value) : 15;
}

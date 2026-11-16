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

const MAX_FILE_BYTES = 1024 * 1024;

/** The local path to actually read: the path itself, or one link hop to a local drive. Throws otherwise. */
function localTarget(fs: FsOps, p: string): string {
  if (!isLocalDrivePath(p)) throw new Error('not a local drive path');
  const st = fs.lstat(p);
  if (!st.isSymbolicLink()) return p;
  // readlink reads the link itself; the target is checked before anything touches it.
  const target = path.resolve(path.dirname(p), fs.readlink(p));
  if (!isLocalDrivePath(target)) throw new Error('link to a non-local path');
  if (fs.lstat(target).isSymbolicLink()) throw new Error('link to a link');
  return target;
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

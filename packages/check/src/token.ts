/**
 * The local token every request (except /v1/health) must carry. Created once, readable only by the
 * user who runs the service, and never logged.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, posix, win32 } from 'node:path';

export interface TokenOptions {
  env: Record<string, string | undefined>;
  home: string;
  platform: NodeJS.Platform;
}

const MIN_LENGTH = 32;

export function tokenPath(opts: TokenOptions): string {
  if (opts.platform === 'win32') {
    const base = opts.env['APPDATA'] || win32.join(opts.home, 'AppData', 'Roaming');
    return win32.join(base, 'Mastyf', 'check', 'token');
  }
  return posix.join(opts.home, '.mastyf', 'check', 'token');
}

/** A token readable by others on Mac and Linux can't be trusted to be secret. */
function ownerOnly(path: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') return true; // the file lives in the user's own profile folder
  return (statSync(path).mode & 0o077) === 0;
}

function readExisting(path: string, platform: NodeJS.Platform): string | null {
  try {
    const value = readFileSync(path, 'utf8').trim();
    if (value.length < MIN_LENGTH) return null;
    return ownerOnly(path, platform) ? value : null;
  } catch {
    return null;
  }
}

export function ensureToken(opts: TokenOptions): string {
  const fromEnv = opts.env['MASTYF_CHECK_TOKEN'];
  if (fromEnv !== undefined) {
    if (fromEnv.length < MIN_LENGTH) throw new Error(`MASTYF_CHECK_TOKEN must be at least ${MIN_LENGTH} characters`);
    return fromEnv;
  }
  const path = tokenPath(opts);
  const existing = readExisting(path, opts.platform);
  if (existing) return existing;

  const token = randomBytes(32).toString('base64url');
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (opts.platform !== 'win32') chmodSync(dir, 0o700);
  // A fresh file, created exclusively with owner-only permissions, then renamed over the old path:
  // the token is never written into a file someone else can read, and a link at the path isn't followed.
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temp, `${token}\n`, { mode: 0o600, flag: 'wx' });
  try {
    renameSync(temp, path);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
  return token;
}

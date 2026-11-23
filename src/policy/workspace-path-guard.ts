import { existsSync, realpathSync, statSync } from 'fs';
import { dirname, isAbsolute, join, basename, parse } from 'path';
import type { McpServerConfig } from '../types.js';

/** Container paths that were always allowed by the built-in guard. */
const BASE_ALLOWED = ['/home/*', '/tmp/*', '/workspace/*', '/app/*'];

/** Never readable or writable through the proxy, wherever they sit. Matched per path segment, any case. */
export const BUILTIN_DENIED_PATHS = [
  '/etc/shadow*', '/etc/ssl/private/*',
  '*.pem', '*.key', '*.pfx', '*.p12', '*.ppk', 'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*',
  '.env', '.env.*', '*.env',
  '.ssh/*', '.aws/*', '.azure/*', '.gnupg/*', '.kube/*', '.docker/*', '.config/gcloud/*',
  '.git-credentials', '.npmrc', '.pypirc', '.netrc', '_netrc',
  // Mastyf's own key and history, and agent settings that hold server secrets
  '.mastyf/*', '.mastyf-ai/*', '.claude.json', '.claude/.credentials.json',
  'AppData/Roaming/*', 'AppData/Local/Microsoft/*', 'AppData/Local/Google/*', 'Library/Keychains/*', 'ntuser.dat*',
];

/**
 * Folders the built-in guard allows: the container paths plus every folder the user named in a local
 * server's own arguments (for example the directory given to server-filesystem). Nothing else, so the
 * home folder as a whole is not opened. MASTYF_AI_ALLOWED_PATHS (comma separated) replaces the list.
 */
export function defaultAllowedPaths(configs: McpServerConfig[] = [], env: NodeJS.ProcessEnv = process.env): string[] {
  const custom = env.MASTYF_AI_ALLOWED_PATHS;
  if (custom && custom.trim()) return custom.split(',').map((p) => p.trim()).filter(Boolean);
  const roots = new Set<string>();
  for (const c of configs) {
    if (c.transport !== 'stdio') continue;
    for (const arg of c.args ?? []) {
      if (typeof arg !== 'string' || !isAbsolute(arg) || parse(arg).root === arg) continue;
      try {
        if (statSync(arg).isDirectory()) roots.add(`${arg.replace(/[\\/]+$/, '')}/*`);
      } catch {
        /* not a path on this machine */
      }
    }
  }
  return [...BASE_ALLOWED, ...roots];
}

/** Forward slashes, no empty or "." segments; Windows ignores trailing dots and spaces, so drop them. */
function normalize(input: string): string {
  const s = input.replace(/\\/g, '/');
  const windows = /^[A-Za-z]:\//.test(s);
  const segments = s
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .map((seg) => (windows ? seg.replace(/[. ]+$/, '') || seg : seg));
  const joined = (s.startsWith('/') ? '/' : '') + segments.join('/');
  return windows ? joined.toLowerCase() : joined;
}

/** Follow links on the part of the path that exists, so a link cannot lead out of an allowed folder. */
function resolveLinks(input: string): string | null {
  if (!isAbsolute(input)) return null;
  let head = input;
  const tail: string[] = [];
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) return null;
    tail.unshift(basename(head));
    head = up;
  }
  try {
    return join(realpathSync.native(head), ...tail);
  } catch {
    return null;
  }
}

const glob = (p: string) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

function matchesDenied(path: string, pattern: string): boolean {
  const body = pattern.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/\*$/, '');
  const segmentGlob = glob(body).replace(/\.\*/g, '[^/]*');
  return new RegExp(`(^|/)${segmentGlob}(/|$)`, 'i').test(path);
}

function matchesAllowed(path: string, pattern: string): boolean {
  const forms = [pattern];
  if (pattern.endsWith('/*')) {
    const real = resolveLinks(pattern.slice(0, -2));
    if (real) forms.push(`${real}/*`);
  }
  return forms.some((form) => {
    if (form.endsWith('/*')) {
      const root = normalize(form.slice(0, -2));
      if (!root.includes('*')) return path === root || path.startsWith(`${root}/`);
    }
    return new RegExp(`^${glob(normalize(form))}$`).test(path);
  });
}

/** Why this path is refused, or null when it is fine. */
export function checkPath(input: string, allowed: string[], denied: string[]): string | null {
  if (input.includes('\0')) return 'Path contains a null byte';
  const slashed = input.replace(/\\/g, '/');
  if (slashed.split('/').some((seg) => seg.replace(/ +$/, '') === '..')) return `Path with ".." is not allowed: ${input}`;

  const lexical = normalize(input);
  const real = resolveLinks(input);
  const views = real ? [lexical, normalize(real)] : [lexical];

  for (const pattern of denied) {
    if (views.some((v) => matchesDenied(v, pattern))) return `Access to path matching "${pattern}" denied: ${input}`;
  }
  if (allowed.length === 0) return null;
  // Network and device paths (//host/share, //?/C:/) and alternate streams (file.txt:stream) never match a folder.
  if (slashed.startsWith('//') || (/^[A-Za-z]:\//.test(slashed) && slashed.slice(2).includes(':'))) {
    return `Path not in allowed list: ${input}`;
  }
  if (!views.every((v) => allowed.some((p) => matchesAllowed(v, p)))) return `Path not in allowed list: ${input}`;
  return null;
}

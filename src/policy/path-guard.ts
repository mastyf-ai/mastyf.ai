/**
 * Filesystem path guard for tool arguments — blocks sensitive paths and optional workspace scoping.
 */
import { translatePath } from '../utils/remote-path.js';
import { translateWslPath } from '../utils/wsl-path.js';

const PATH_ARG_FIELDS = new Set(['path', 'file', 'filepath', 'file_path', 'directory', 'dir']);

/** Paths that must never be read/list even when tools are allowlisted. */
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/etc(?:\/|$)/,
  /^\/root(?:\/|$)/,
  /^\/proc(?:\/|$)/,
  /\/proc\/self\/environ/,
  /link_to.*(?:aws|credential|secret|\.env)/i,
  /&ref\s+\/(?:etc|proc|root|\.)/i,
  /yaml\s*anchor/i,
  /^\/sys(?:\/|$)/,
  /\/\.ssh(?:\/|$)/,
  /\/\.aws\/credentials$/,
  /\/\.env(?:\.|$)/,
  /(?:^|\/)id_rsa(?:\.|$)/,
  /(?:^|\/)authorized_keys$/,
  /\/\.gnupg(?:\/|$)/,
  /\/\.kube(?:\/|$)/,
  /(?:^|\/)\.kube\/config$/,
  /\/root\/\.kube\/config$/,
  /\/etc\/kubernetes\/admin\.conf$/,
  /(?:^|\/)kubeconfig$/,
  /\/\.docker(?:\/|$)/,
  /\/var\/run\/docker\.sock$/,
  /\/var\/run\/secrets\/kubernetes\.io\//,
  /(?:^|\/)terraform\.tfstate(?:\.|$)/,
  /(?:^|\/)\.npmrc$/,
  /(?:^|\/)\.git-credentials$/,
  /(?:^|\/)\.vault-token$/,
  /(?:^|\/)service-account[^/]*\.json$/i,
  /(?:^|\/)service_account[^/]*\.json$/i,
  /(?:^|\/)[^/]*-service-account[^/]*\.json$/i,
  /(?:^|\/)gcp[^/]*service[^/]*account[^/]*\.json$/i,
  /(?:^|\/)serviceAccountKey[^/]*\.json$/i,
  /(?:^|\/)passwd$/,
  /(?:^|\/)shadow$/,
];

export function extractPathArgumentValues(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const values: string[] = [];
  for (const [key, val] of Object.entries(args)) {
    if (!PATH_ARG_FIELDS.has(key.toLowerCase())) continue;
    if (typeof val === 'string') values.push(val);
  }
  return values;
}

function allowedPathPrefixes(): string[] {
  const prefixes: string[] = [];
  const workspace = process.env.GUARDIAN_WORKSPACE?.trim();
  if (workspace) prefixes.push(translatePath(workspace));
  const list = process.env.GUARDIAN_ALLOWED_PATH_PREFIXES?.split(',').map((s) => s.trim()).filter(Boolean);
  if (list?.length) prefixes.push(...list.map(translatePath));
  return prefixes;
}

function isUnderPrefix(path: string, prefix: string): boolean {
  const normPath = path.replace(/\\/g, '/');
  const normPrefix = prefix.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normPrefix) return false;
  return normPath === normPrefix || normPath.startsWith(`${normPrefix}/`);
}

export interface PathGuardResult {
  block: boolean;
  reason?: string;
}

/** Lowercase, slash-normalize, and collapse `..` segments for consistent matching. */
export function normalizePathForGuard(raw: string): string {
  let path = translatePath(translateWslPath(raw)).replace(/\\/g, '/').toLowerCase();
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.length ? `/${parts.join('/')}` : '/';
}

export function evaluatePathGuard(paths: string[]): PathGuardResult {
  for (const raw of paths) {
    const path = normalizePathForGuard(raw);

    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(path)) {
        return {
          block: true,
          reason: `Sensitive path blocked: ${path}`,
        };
      }
    }

    const prefixes = allowedPathPrefixes();
    if (prefixes.length > 0 && !prefixes.some((p) => isUnderPrefix(path, p))) {
      return {
        block: true,
        reason: `Path outside allowed workspace: ${path} (allowed: ${prefixes.join(', ')})`,
      };
    }
  }
  return { block: false };
}

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
  /(?:^|\/)\.env(?:\.|$)/,
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
  /\/\.bash_history$/,
  /\/\.zsh_history$/,
  /\/\.mysql_history$/,
  /\/\.psql_history$/,
  /\/\.pgpass$/,
  /\/\.s3cfg$/,
  /\/\.azure(?:\/|$)/,
  /\/\.gcloud(?:\/|$)/,
  /\/\.config\/gcloud\//,
  /\/\.config\/gh\//,
  /\/\.config\/hub\//,
  /\/\.git-credentials$/,
  /\/\.gitconfig$/,
  /\/\.helm\//,
  /\/\.kube\/(?:cache|http-cache|config)$/,
  /\/var\/log\//,
  /\/var\/backups\//,
  /\/var\/spool\//,
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

/**
 * Normalized exactly like the paths they are compared with (workspacePath). They used to be
 * left as given, so on Windows ("C:\Users\…" vs "/c:/users/…") and on macOS ("/Users/…" vs
 * "/users/…") no path was ever inside the workspace and every file read was blocked.
 */
function allowedPathPrefixes(): string[] {
  const prefixes: string[] = [];
  const workspace = process.env.MASTYF_AI_WORKSPACE?.trim();
  if (workspace) prefixes.push(workspacePath(workspace));
  const list = process.env.MASTYF_AI_ALLOWED_PATH_PREFIXES?.split(',').map((s) => s.trim()).filter(Boolean);
  if (list?.length) prefixes.push(...list.map(workspacePath));
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
  return canonicalPath(raw).toLowerCase();
}

/**
 * For the workspace check, letter case counts where the file system counts it: Windows and
 * macOS ignore it, Linux does not (/home/u/APP is a different folder from /home/u/app).
 */
function workspacePath(raw: string): string {
  const path = canonicalPath(raw);
  const ignoresCase =
    process.platform === 'win32' || process.platform === 'darwin' || /^\/[a-z]:(?:\/|$)/i.test(path);
  return ignoresCase ? path.toLowerCase() : path;
}

/** Slash-normalize and collapse `..` segments, keeping letter case. */
function canonicalPath(raw: string): string {
  const path = translatePath(translateWslPath(raw)).replace(/\\/g, '/');
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
    const inWorkspace = workspacePath(raw);
    if (prefixes.length > 0 && !prefixes.some((p) => isUnderPrefix(inWorkspace, p))) {
      return {
        block: true,
        reason: `Path outside allowed workspace: ${inWorkspace} (allowed: ${prefixes.join(', ')})`,
      };
    }
  }
  return { block: false };
}

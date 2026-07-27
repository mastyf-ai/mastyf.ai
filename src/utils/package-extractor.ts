import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { McpServerConfig } from '../types.js';

const SCOPED_NPM = /@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*/gi;
const BARE_NPM = /^[a-z0-9][a-z0-9._-]*$/i;
const LOCK_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'] as const;

/** Skip paths, URLs, and numeric npx/uvx args that are not package names. */
export function isLikelyPackageArg(arg: string): boolean {
  if (!arg || arg.startsWith('-')) return false;
  if (/^[\d.]+$/.test(arg)) return false;
  if (arg.startsWith('/') || arg.startsWith('.') || arg.includes('\\')) return false;
  if (arg.includes('://') || arg.includes('=')) return false;
  if (/^[A-Za-z]:\\/.test(arg)) return false;
  return true;
}

/**
 * Extract npm/PyPI package identifiers from MCP server command lines.
 */
export function extractPackagesFromServer(
  server: Pick<McpServerConfig, 'command' | 'args' | 'packageName'>,
): string[] {
  const found = new Set<string>();
  const declared = server.packageName?.trim();
  if (declared && isLikelyPackageArg(declared) && !/^[\d.]+$/.test(declared) && declared.length >= 2) {
    found.add(declared);
  }

  const command = (server.command ?? '').trim().toLowerCase();
  const args = server.args ?? [];

  for (const arg of args) {
    if (!isLikelyPackageArg(arg)) continue;
    for (const match of arg.matchAll(SCOPED_NPM)) {
      found.add(match[0]);
    }
    if (arg.startsWith('@') && arg.includes('/')) found.add(arg);
  }

  if (command === 'npx' || command.endsWith('/npx')) {
    for (const arg of args) {
      if (!isLikelyPackageArg(arg)) continue;
      if (arg.startsWith('@') && arg.includes('/')) found.add(arg);
      else if (BARE_NPM.test(arg) && arg.length >= 2) found.add(arg);
    }
  }

  if (command === 'uvx' || command === 'uv' || command.includes('python')) {
    for (const arg of args) {
      if (!isLikelyPackageArg(arg)) continue;
      if (!arg.includes('/') && arg.length > 1 && !/^[\d.]+$/.test(arg)) found.add(arg);
    }
  }

  return [...found];
}

/** Locate a lockfile near a path (walks up to maxUp parents). */
export function findLockfileNearPath(startPath: string, maxUp = 4): string | null {
  let cur = resolve(startPath);
  for (let i = 0; i < maxUp; i++) {
    for (const name of LOCK_NAMES) {
      const p = join(cur, name);
      if (existsSync(p)) return p;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/** Best-effort package install root for SBOM / transitive CVE scanning. */
export function resolvePackageRootFromServer(
  server: Pick<McpServerConfig, 'command' | 'args' | 'packageName'>,
): string | null {
  if (server.packageName?.trim()) {
    const nm = join(process.cwd(), 'node_modules', ...server.packageName.trim().split('/'));
    if (existsSync(nm)) return nm;
  }
  for (const arg of server.args ?? []) {
    if (/\.(m?js|cjs)$/.test(arg)) {
      const dir = dirname(resolve(arg));
      if (existsSync(dir)) return dir;
    }
  }
  return null;
}

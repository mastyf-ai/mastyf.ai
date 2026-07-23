#!/usr/bin/env node
/**
 * Prepare root @mastyf_ai/server for npm pack/publish:
 * - Rewrite workspace: deps to semver (^matching published package versions)
 * - Strip maintainer-only lifecycle scripts from the tarball (reduces install-script scanner alerts)
 * Restored by postpack-npm-deps.mjs.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const pkgPath = process.env.PREPACK_PKG ?? join(process.cwd(), 'package.json');
const backupPath = pkgPath + '.prepack-backup';

/** Scripts that must not ship to npm consumers (Socket / npm supply-chain scanners). */
const STRIP_SCRIPT_KEYS = new Set([
  'postinstall',
  'preinstall',
  'install',
  'prepare',
  'prepack',
  'postpack',
  'prepublishOnly',
  'prepublish',
]);

function loadWorkspaceVersionMap() {
  const map = {};
  for (const rel of [
    'packages/core/package.json',
    'packages/plugin-sdk/package.json',
    'packages/cli/package.json',
    'packages/server/package.json',
  ]) {
    const full = join(ROOT, rel);
    if (!existsSync(full)) continue;
    const j = JSON.parse(readFileSync(full, 'utf8'));
    if (j.name && j.version) map[j.name] = `^${j.version}`;
  }
  return map;
}

const VERSION_MAP = loadWorkspaceVersionMap();
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
writeFileSync(backupPath, readFileSync(pkgPath, 'utf8'));

let changed = false;
for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  const deps = pkg[section];
  if (!deps || typeof deps !== 'object') continue;
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === 'string' && spec.startsWith('workspace:') && VERSION_MAP[name]) {
      deps[name] = VERSION_MAP[name];
      changed = true;
      console.error(`[prepack] ${name} → ${VERSION_MAP[name]}`);
    }
  }
}

if (pkg.scripts && typeof pkg.scripts === 'object') {
  for (const key of Object.keys(pkg.scripts)) {
    if (STRIP_SCRIPT_KEYS.has(key)) {
      changed = true;
      console.error(`[prepack] stripped lifecycle script "${key}"`);
    }
  }
  for (const key of STRIP_SCRIPT_KEYS) {
    if (pkg.scripts[key]) delete pkg.scripts[key];
  }
  // Consumer tarballs must not ship maintainer/dev scripts (supply-chain scanners).
  if (Object.keys(pkg.scripts).length > 0) {
    delete pkg.scripts;
    changed = true;
    console.error('[prepack] stripped scripts block (npm consumer tarball)');
  }
}

if (changed) {
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

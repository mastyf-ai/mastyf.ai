#!/usr/bin/env node
/**
 * Rewrite workspace: deps to semver for npm pack/publish tarballs.
 * Restored by postpack-npm-deps.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pkgPath = process.env.PREPACK_PKG ?? join(process.cwd(), 'package.json');
const backupPath = pkgPath + '.prepack-backup';

const VERSION_MAP = {
  '@mcp-guardian/plugin-sdk': '^3.0.0',
  '@mcp-guardian/core': '^2.9.6',
  '@mcp-guardian/server': '^2.9.6',
};

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
writeFileSync(backupPath, readFileSync(pkgPath, 'utf8'));

let changed = false;
for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  const deps = pkg[section];
  if (!deps || typeof deps !== 'object') continue;
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === 'string' && spec.startsWith('workspace:') && VERSION_MAP[name]) {
      deps[name] = VERSION_MAP[name];
      changed = true;
      console.log(`[prepack] ${name} → ${VERSION_MAP[name]} (${pkgPath})`);
    }
  }
}

if (changed) {
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

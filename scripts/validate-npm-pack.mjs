#!/usr/bin/env node
/**
 * Fail if `npm pack` would ship workspace: specs or install lifecycle scripts.
 * Run from package root (monorepo root for @mastyf_ai/server, or packages/cli).
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = process.cwd();
const raw = execSync('npm pack --silent 2>/dev/null', { cwd, encoding: 'utf8' });
const tgzName = raw
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.endsWith('.tgz'))
  .pop();
if (!tgzName) {
  console.error('[validate-npm-pack] npm pack did not produce a .tgz filename');
  process.exit(1);
}
const tgzPath = join(cwd, tgzName);

try {
  const raw = execSync(`tar -xOf ${JSON.stringify(tgzPath)} package/package.json`, {
    encoding: 'utf8',
  });
  const pkg = JSON.parse(raw);
  const errors = [];

  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = pkg[section];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) {
        errors.push(`${section}.${name} = ${spec} (prepack did not rewrite workspace spec)`);
      }
    }
  }

  const blockedScripts = ['postinstall', 'preinstall', 'install'];
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const key of blockedScripts) {
      if (pkg.scripts[key]) {
        errors.push(`scripts.${key} must not ship in npm tarball`);
      }
    }
  }

  if (pkg.name === '@mastyf_ai/server') {
    try {
      execSync(
        `tar -xOf ${JSON.stringify(tgzPath)} package/deploy/dashboard-spa/out/index.html`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch {
      errors.push(
        'deploy/dashboard-spa/out/index.html missing from tarball (run: npm run dashboard:build; ensure deploy/dashboard-spa/.npmignore un-ignores out/ for npm pack)',
      );
    }
  }

  if (errors.length > 0) {
    console.error(`[validate-npm-pack] ${pkg.name}@${pkg.version} tarball is not safe to publish:\n`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`[validate-npm-pack] OK ${pkg.name}@${pkg.version} (${tgzName})`);
} finally {
  if (existsSync(tgzPath)) unlinkSync(tgzPath);
  const postpack = join(dirname(fileURLToPath(import.meta.url)), 'postpack-npm-deps.mjs');
  spawnSync(process.execPath, [postpack], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, PREPACK_PKG: join(cwd, 'package.json') },
  });
}

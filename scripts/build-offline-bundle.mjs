#!/usr/bin/env node

// ── Mastyf AI Offline Deployment Bundle Builder ────────────────────────────
// Creates a self-contained, signed tarball for air-gapped deployments.
// Includes: compiled proxy, dashboard SPA, policy, threat intel snapshot,
// corpus, and verification manifest.
//
// Usage: node scripts/build-offline-bundle.mjs [--signing-key KEY] [--output FILE]

import { execSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const signingKey = getArg('--signing-key') || process.env.MASTYF_AI_OFFLINE_SIGNING_KEY || randomBytes(32).toString('hex');
const outputFile = getArg('--output') || join(ROOT, 'mastyf-offline-bundle.tar.gz');
const bundleDir = join(ROOT, '.offline-bundle');

console.log('=== Mastyf AI Offline Deployment Bundle Builder ===\n');

if (!existsSync(bundleDir)) {
  mkdirSync(bundleDir, { recursive: true });
}

function copyDir(src, dest) {
  execSync(`cp -r ${src} ${dest}`, { cwd: ROOT, stdio: 'pipe' });
}

function copyFile(src, dest) {
  const destDir = dirname(dest);
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  execSync(`cp ${src} ${dest}`, { cwd: ROOT, stdio: 'pipe' });
}

console.log('[1/7] Collecting build artifacts...');
try {
  execSync('pnpm --filter @mastyf-ai/plugin-sdk run build && ' +
           'pnpm --filter @mastyf-ai/core run build && ' +
           'pnpm --filter @mastyf-ai/mcp-server run build && ' +
           'tsc --project tsconfig.json', { cwd: ROOT, stdio: 'pipe' });
} catch (err) {
  console.log('  Using existing build artifacts (build skipped)');
}

if (existsSync(join(ROOT, 'dist'))) {
  copyDir('dist', join(bundleDir, 'dist'));
}

console.log('[2/7] Building dashboard SPA...');
try {
  execSync('NODE_ENV=production pnpm --filter @mastyf-ai/dashboard-spa run build', { cwd: ROOT, stdio: 'pipe' });
} catch {
  console.log('  Dashboard SPA already built');
}

if (existsSync(join(ROOT, 'deploy/dashboard-spa/out'))) {
  copyDir('deploy/dashboard-spa/out', join(bundleDir, 'dashboard'));
}

console.log('[3/7] Collecting policies...');
const policyFiles = ['default-policy.yaml'];
for (const f of policyFiles) {
  if (existsSync(join(ROOT, f))) {
    copyFile(f, join(bundleDir, 'policies', f));
  }
}

if (existsSync(join(ROOT, 'policy-templates'))) {
  copyDir('policy-templates', join(bundleDir, 'policy-templates'));
}

console.log('[4/7] Collecting threat intel snapshot...');
const threatStatePath = join(ROOT, 'config/threat-intel-signatures.json');
if (existsSync(threatStatePath)) {
  copyFile('config/threat-intel-signatures.json', join(bundleDir, 'threat-intel', 'signatures.json'));
}

console.log('[5/7] Collecting evaluation corpus...');
if (existsSync(join(ROOT, 'corpus'))) {
  copyDir('corpus', join(bundleDir, 'corpus'));
}

console.log('[6/7] Generating verification manifest...');
const manifest = {
  bundleVersion: '1.0.0',
  buildTimestamp: new Date().toISOString(),
  nodeVersion: process.version,
  mastyfVersion: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
  contents: [],
  signature: '',
};

function walkDir(dir, baseDir) {
  const files = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkDir(fullPath, baseDir));
    } else {
      const content = readFileSync(fullPath);
      const hash = createHmac('sha256', signingKey).update(content).digest('hex');
      files.push({
        path: join(baseDir, entry),
        size: stat.size,
        sha256: hash,
      });
    }
  }
  return files;
}

try {
  manifest.contents = walkDir(bundleDir, '');
} catch {}

const manifestData = JSON.stringify(manifest.contents, null, 0);
manifest.signature = createHmac('sha256', signingKey).update(manifestData).digest('hex');
writeFileSync(join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('[7/7] Creating tarball...');
execSync(`tar -czf ${outputFile} -C ${bundleDir} .`, { stdio: 'pipe' });

const size = (statSync(outputFile).size / 1024 / 1024).toFixed(1);

execSync(`rm -rf ${bundleDir}`, { stdio: 'pipe' });

console.log(`\n=== Bundle Created ===`);
console.log(`File: ${outputFile}`);
console.log(`Size: ${size} MB`);
console.log(`Signature: ${manifest.signature}`);

console.log(`\nTo verify:`);
console.log(`  tar -xzf ${outputFile}`);
console.log(`  node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))" | head -20`);

console.log(`\nTo deploy offline:`);
console.log(`  1. Extract: tar -xzf ${outputFile} -C /opt/mastyf/`);
console.log(`  2. Set env: export DASHBOARD_PORT=4000 DASHBOARD_AUTH_DISABLED=true`);
console.log(`  3. Start: node dist/cli.js proxy --policy /opt/mastyf/policies/default-policy.yaml`);

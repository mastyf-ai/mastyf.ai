#!/usr/bin/env node
/**
 * Fails CI when root @mastyf_ai/server version drifts from workspace packages
 * that are intended to ship in lockstep (core, server, cli).
 */
const { readFileSync } = require('fs');
const { resolve } = require('path');

const ROOT = resolve(__dirname, '..');

function readVersion(pkgPath) {
  return JSON.parse(readFileSync(resolve(ROOT, pkgPath), 'utf-8')).version;
}

const rootVersion = readVersion('package.json');
const locked = [
  'packages/core/package.json',
  'packages/server/package.json',
  'packages/cli/package.json',
];

const mismatches = [];
for (const p of locked) {
  const v = readVersion(p);
  if (v !== rootVersion) mismatches.push(`${p}: ${v} (expected ${rootVersion})`);
}

if (mismatches.length > 0) {
  console.error('Version alignment check FAILED:\n' + mismatches.map((m) => `  - ${m}`).join('\n'));
  process.exit(1);
}

const pluginSdk = readVersion('packages/plugin-sdk/package.json');
console.log(`OK: root @mastyf_ai/server ${rootVersion}; core/server/cli aligned.`);
console.log(`Note: @mastyf_ai/plugin-sdk is independently versioned (${pluginSdk}).`);

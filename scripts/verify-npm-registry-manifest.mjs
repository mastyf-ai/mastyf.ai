#!/usr/bin/env node
/**
 * Fail if npm registry manifest still lists workspace: deps (broken install).
 * Usage: node scripts/verify-npm-registry-manifest.mjs @mastyf_ai/server 4.1.5
 */
const [name, version] = process.argv.slice(2);
if (!name || !version) {
  console.error('Usage: node scripts/verify-npm-registry-manifest.mjs <package> <version>');
  process.exit(1);
}

const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`[verify-registry] ${name}@${version} not found (${res.status})`);
  process.exit(1);
}
const manifest = await res.json();
const deps = manifest.dependencies ?? {};
const bad = Object.entries(deps).filter(([, spec]) => typeof spec === 'string' && spec.startsWith('workspace:'));
if (bad.length > 0) {
  console.error(`[verify-registry] ${name}@${version} has broken manifest deps:`);
  for (const [dep, spec] of bad) console.error(`  ${dep}: ${spec}`);
  process.exit(1);
}
console.log(`[verify-registry] OK ${name}@${version} (no workspace: deps in registry manifest)`);

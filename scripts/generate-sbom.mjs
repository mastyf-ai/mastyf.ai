#!/usr/bin/env node
/**
 * Generate CycloneDX 1.4 Software Bill of Materials (SBOM).
 * Enterprise Phase 4 — Supply Chain Hardening.
 *
 * Output: reports/supply-chain/sbom-cyclonedx.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const SBOM_DIR = join(REPO_ROOT, 'reports', 'supply-chain');
const PKG_JSON = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
const LOCK_PATH = join(REPO_ROOT, 'pnpm-lock.yaml');

function parseDependencies() {
  const components = [];
  const allDeps = {
    ...(PKG_JSON.dependencies || {}),
    ...(PKG_JSON.devDependencies || {}),
    ...(PKG_JSON.optionalDependencies || {}),
  };

  // Read lockfile for resolved versions
  let lockVersions = {};
  try {
    const lock = readFileSync(LOCK_PATH, 'utf-8');
    const lines = lock.split('\n');
    let currentPkg = '';
    for (const line of lines) {
      const pkgMatch = line.match(/^  ['"]?(@?[^'":]+)['"]?:\s*$/);
      if (pkgMatch) currentPkg = pkgMatch[1];
      const verMatch = line.match(/^\s+version:\s+['"]?([\d.]+)['"]?\s*$/);
      if (verMatch && currentPkg) {
        lockVersions[currentPkg] = verMatch[1].replace(/^v/, '');
      }
    }
  } catch { /* lock file may not exist */ }

  for (const [name, version] of Object.entries(allDeps)) {
    const resolvedVersion = lockVersions[name] || String(version).replace(/^[\^~]/, '');
    const bomRef = `${name}@${resolvedVersion}`;
    components.push({
      type: 'library',
      name,
      version: resolvedVersion,
      'bom-ref': bomRef,
      purl: `pkg:npm/${name}@${resolvedVersion}`,
    });
  }
  return components;
}

function generateSbom() {
  const components = parseDependencies();
  const sbom = {
    $schema: 'http://cyclonedx.org/schema/bom-1.4.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.4',
    serialNumber: `urn:uuid:${createHash('md5').update(Date.now().toString()).digest('hex')}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'mastyf-ai', name: 'generate-sbom', version: PKG_JSON.version }],
      component: {
        type: 'application',
        name: '@mastyf_ai/server',
        version: PKG_JSON.version,
        'bom-ref': `@mastyf_ai/server@${PKG_JSON.version}`,
      },
    },
    components,
    dependencies: components.map((c) => ({
      ref: c['bom-ref'],
      dependsOn: [],
    })),
  };

  mkdirSync(SBOM_DIR, { recursive: true });
  const outPath = join(SBOM_DIR, 'sbom-cyclonedx.json');
  writeFileSync(outPath, JSON.stringify(sbom, null, 2));
  console.log(`[sbom] CycloneDX SBOM written: ${outPath}`);
  console.log(`[sbom] ${components.length} components documented`);
}

generateSbom();
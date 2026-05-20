#!/usr/bin/env node
/**
 * Aggregate 80+ custom evasion fixtures into evasion-attacks.json (canonical list).
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const CUSTOM = join(__dir, '..', 'fixtures', 'custom-attacks');
const OUT_HARNESS = join(__dir, '..', 'evasion-attacks.json');
const OUT_TESTS = join(__dir, '../../tests/adversarial-harness/evasion-attacks.json');

function loadAll(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...loadAll(full));
    else if (name.endsWith('.json')) out.push(JSON.parse(readFileSync(full, 'utf-8')));
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

const attacks = loadAll(CUSTOM);
const bundle = {
  version: 1,
  generatedAt: new Date().toISOString(),
  count: attacks.length,
  description: '80+ adversarial evasion probes (encoding, unicode, SSRF, shell, SQL, tool-chain)',
  attacks,
};

mkdirSync(dirname(OUT_TESTS), { recursive: true });
writeFileSync(OUT_HARNESS, JSON.stringify(bundle, null, 2));
writeFileSync(OUT_TESTS, JSON.stringify(bundle, null, 2));
console.log(`Wrote ${attacks.length} evasion attacks → ${OUT_HARNESS}`);

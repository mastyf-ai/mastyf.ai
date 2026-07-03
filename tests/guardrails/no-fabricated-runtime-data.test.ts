import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCAN_DIRS = [
  'src',
  'deploy/dashboard-spa/app',
  'deploy/dashboard-spa/lib',
  'apps/cloud/app',
  'apps/cloud/components',
  'apps/cloud/lib',
  'mastyf-ai-configs',
  'scenarios/dogfood',
  'scenarios/real-life',
];

const ALLOWED_PATH_PARTS = [
  '/adversarial-harness/',
  '/benchmarks/fixtures/',
  '/corpus/',
  '/tests/',
  '/test/',
  '/fixtures/',
  '/policy/semantic-guards.ts',
  '/scanners/prompt-injection-detector.ts',
  '/scanners/secret-rules.ts',
];

const ALLOWED_CONTEXT = [
  'decoy',
  'adversarial',
  'attack corpus',
  'corpus fixture',
  'test-only',
  'placeholder=',
  'placeholder:',
  '::placeholder',
  'fallback ids cannot correlate',
  'unavailable',
  'no synthetic',
  'not synthetic',
  'synthetic-only',
  'rejected',
  'not a mock',
];

const bannedTerms = ['mock', 'dummy', 'fake', 'stub', 'synthetic'];
const bannedPattern = new RegExp(`\\b(${bannedTerms.join('|')})\\b`, 'i');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next' || entry === 'out') continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|json|md)$/.test(entry)) out.push(path);
  }
  return out;
}

function isAllowedPath(path: string): boolean {
  const normalized = `/${relative(ROOT, path).replaceAll('\\', '/')}`;
  return ALLOWED_PATH_PARTS.some((allowed) => normalized.includes(allowed));
}

describe('production data guardrails', () => {
  it('keeps runtime paths free of fabricated-data terms', () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        if (isAllowedPath(file)) continue;
        const rel = relative(ROOT, file);
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, index) => {
          if (!bannedPattern.test(line)) return;
          const lower = line.toLowerCase();
          if (ALLOWED_CONTEXT.some((allowed) => lower.includes(allowed))) return;
          violations.push(`${rel}:${index + 1}: ${line.trim()}`);
        });
      }
    }
    expect(violations).toEqual([]);
  });
});

#!/usr/bin/env tsx
/**
 * Enterprise corpus evaluation — PolicyEngine + default-policy.yaml.
 * Exits non-zero if any attack expected "block" is not blocked, or benign "pass" is blocked.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { PolicyEngine } from '../src/policy/policy-engine.js';
import type { CallContext, PolicyConfig, PolicyDecision } from '../src/policy/policy-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_ROOT = __dirname;
const POLICY_PATH = join(__dirname, '..', 'default-policy.yaml');
const MANIFEST_PATH = join(__dirname, 'manifest.yaml');
const REPORT_PATH = join(__dirname, '..', 'corpus-eval-report.json');

const DEFAULT_MIN_ENTRIES = 200;
const DEFAULT_MIN_F1 = 0.85;
const DEFAULT_MIN_ATTACK_SAMPLES = 50;

export interface CorpusEntry {
  toolName: string;
  arguments: Record<string, unknown>;
  expected: 'block' | 'pass';
  category: string;
  ruleHint?: string;
}

interface CategoryMetrics {
  category: string;
  total: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  failures: string[];
}

interface EvalReport {
  timestamp: string;
  policy: string;
  totalEntries: number;
  overall: { tp: number; fp: number; tn: number; fn: number; precision: number; recall: number; f1: number };
  byCategory: CategoryMetrics[];
  attackBlockRate: number;
  benignPassRate: number;
  failures: string[];
  passed: boolean;
}

function loadCorpusFiles(dir: string): { relPath: string; entry: CorpusEntry }[] {
  const out: { relPath: string; entry: CorpusEntry }[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...loadCorpusFiles(full));
    } else if (name.endsWith('.json')) {
      const entry = JSON.parse(readFileSync(full, 'utf8')) as CorpusEntry;
      out.push({ relPath: relative(CORPUS_ROOT, full), entry });
    }
  }
  return out;
}

function isBlocked(decision: PolicyDecision): boolean {
  return decision.action === 'block';
}

function ctx(toolName: string, args: Record<string, unknown>): CallContext {
  return {
    serverName: 'corpus-eval',
    toolName,
    arguments: args,
    requestId: 'corpus-1',
    requestTokens: 50,
    timestamp: new Date().toISOString(),
  };
}

function updateCategoryMetrics(
  map: Map<string, CategoryMetrics>,
  category: string,
  expected: 'block' | 'pass',
  blocked: boolean,
  relPath: string,
  decision: PolicyDecision,
): void {
  let m = map.get(category);
  if (!m) {
    m = { category, total: 0, tp: 0, fp: 0, tn: 0, fn: 0, precision: 0, recall: 0, failures: [] };
    map.set(category, m);
  }
  m.total++;

  if (expected === 'block') {
    if (blocked) m.tp++;
    else {
      m.fn++;
      m.failures.push(`MISSED [${relPath}] expected block, got ${decision.action} (${decision.rule ?? 'none'})`);
    }
  } else {
    if (!blocked) m.tn++;
    else {
      m.fp++;
      m.failures.push(`FALSE POS [${relPath}] expected pass, got block (${decision.rule}: ${decision.reason ?? ''})`);
    }
  }
}

function finalizeCategory(m: CategoryMetrics): void {
  m.precision = m.tp / (m.tp + m.fp) || 0;
  m.recall = m.tp / (m.tp + m.fn) || 0;
}

function loadMinimumEntries(): number {
  try {
    const manifest = load(readFileSync(MANIFEST_PATH, 'utf8')) as { minimum_entries?: number };
    return manifest.minimum_entries ?? DEFAULT_MIN_ENTRIES;
  } catch {
    return DEFAULT_MIN_ENTRIES;
  }
}

export async function runEval(): Promise<EvalReport> {
  const policy = load(readFileSync(POLICY_PATH, 'utf8')) as PolicyConfig;
  const engine = new PolicyEngine(policy);
  const files = loadCorpusFiles(CORPUS_ROOT).filter(
    (f) => !f.relPath.endsWith('run-eval.ts') && f.relPath !== 'manifest.yaml',
  );

  const minimumEntries = loadMinimumEntries();
  if (files.length < minimumEntries) {
    throw new Error(
      `Corpus has ${files.length} entries but manifest requires at least ${minimumEntries}`,
    );
  }

  const byCategory = new Map<string, CategoryMetrics>();
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  const failures: string[] = [];
  let attackTotal = 0,
    attackBlocked = 0,
    benignTotal = 0,
    benignPassed = 0;

  console.log(`Running corpus evaluation (${files.length} entries) against ${POLICY_PATH}\n`);

  for (const { relPath, entry } of files) {
    const decision = engine.evaluate(ctx(entry.toolName, entry.arguments ?? {}));
    const blocked = isBlocked(decision);
    const expected = entry.expected;
    const category = entry.category;

    updateCategoryMetrics(byCategory, category, expected, blocked, relPath, decision);

    if (expected === 'block') {
      attackTotal++;
      if (blocked) {
        tp++;
        attackBlocked++;
        process.stdout.write(`  ✓ ${relPath}\n`);
      } else {
        fn++;
        const msg = `MISSED [${relPath}] ${entry.toolName} → ${decision.action}`;
        failures.push(msg);
        process.stdout.write(`  ✗ ${relPath}\n`);
      }
    } else {
      benignTotal++;
      if (!blocked) {
        tn++;
        benignPassed++;
        process.stdout.write(`  ✓ ${relPath} (pass)\n`);
      } else {
        fp++;
        const msg = `FALSE POS [${relPath}] rule=${decision.rule}`;
        failures.push(msg);
        process.stdout.write(`  ✗ ${relPath} (false positive)\n`);
      }
    }
  }

  for (const m of byCategory.values()) finalizeCategory(m);

  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = (2 * precision * recall) / (precision + recall) || 0;
  const attackBlockRate = attackTotal ? attackBlocked / attackTotal : 1;
  const benignPassRate = benignTotal ? benignPassed / benignTotal : 1;
  const passed = fn === 0 && fp === 0;

  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    policy: POLICY_PATH,
    totalEntries: files.length,
    overall: { tp, fp, tn, fn, precision, recall, f1 },
    byCategory: [...byCategory.values()].sort((a, b) => a.category.localeCompare(b.category)),
    attackBlockRate,
    benignPassRate,
    failures,
    passed,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`
CORPUS EVALUATION RESULTS
Entries: ${files.length} | Attacks blocked: ${attackBlocked}/${attackTotal} (${(attackBlockRate * 100).toFixed(1)}%)
Benign passed: ${benignPassed}/${benignTotal} (${(benignPassRate * 100).toFixed(1)}%)

Overall — TP: ${tp} FP: ${fp} TN: ${tn} FN: ${fn}
Precision: ${(precision * 100).toFixed(1)}% | Recall: ${(recall * 100).toFixed(1)}% | F1: ${(f1 * 100).toFixed(1)}%

Per category:`);
  for (const m of report.byCategory) {
    console.log(
      `  ${m.category}: n=${m.total} recall=${(m.recall * 100).toFixed(1)}% precision=${(m.precision * 100).toFixed(1)}% failures=${m.failures.length}`,
    );
  }

  if (failures.length > 0) {
    console.log('\nFAILURES:\n' + failures.slice(0, 50).join('\n'));
    if (failures.length > 50) console.log(`... and ${failures.length - 50} more`);
  }

  console.log(`\nReport written to ${REPORT_PATH}`);
  return report;
}

async function main() {
  const report = await runEval();
  const minF1 = parseFloat(process.env['CORPUS_MIN_F1'] ?? String(DEFAULT_MIN_F1));
  const minAttackSamples = parseInt(
    process.env['CORPUS_MIN_ATTACK_SAMPLES'] ?? String(DEFAULT_MIN_ATTACK_SAMPLES),
    10,
  );
  const attackSamples = report.overall.tp + report.overall.fn;

  if (attackSamples < minAttackSamples) {
    console.error(
      `\nCorpus evaluation FAILED — only ${attackSamples} attack samples (minimum ${minAttackSamples})`,
    );
    process.exit(1);
  }

  if (report.overall.f1 < minF1) {
    console.error(
      `\nCorpus evaluation FAILED — F1 ${(report.overall.f1 * 100).toFixed(1)}% below minimum ${(minF1 * 100).toFixed(1)}%`,
    );
    process.exit(1);
  }

  if (!report.passed) {
    console.error('\nCorpus evaluation FAILED — fix missed attacks or false positives');
    process.exit(1);
  }
  console.log('\nCorpus evaluation passed');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('run-eval.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

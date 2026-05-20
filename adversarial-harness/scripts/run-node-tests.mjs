#!/usr/bin/env node
/**
 * Run adversarial Node tests and parse Vitest JSON report (stdout may contain log lines).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '../..');
const REPORT_DIR = join(__dir, '..', 'reports');
const JSON_OUT = join(REPORT_DIR, 'node-vitest.json');
const SUMMARY_OUT = join(REPORT_DIR, 'node-tests-summary.json');

const tests = [
  'adversarial-harness/node/async-queue.test.mjs',
  'adversarial-harness/node/streaming-race.test.mjs',
  'adversarial-harness/node/secret-scanner.test.mjs',
  'adversarial-harness/node/proxy-pipeline.test.mjs',
  'adversarial-harness/node/concurrency-latency.test.mjs',
];

mkdirSync(REPORT_DIR, { recursive: true });

const r = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', ...tests, '--reporter=json', `--outputFile=${JSON_OUT}`],
  { cwd: ROOT, encoding: 'utf-8' },
);

let summary = { ok: false, passed: 0, failed: 0, total: 0, error: null };

if (existsSync(JSON_OUT)) {
  try {
    const report = JSON.parse(readFileSync(JSON_OUT, 'utf-8'));
    const files = report.testResults ?? report.files ?? [];
    let passed = 0;
    let failed = 0;
    for (const file of files) {
      for (const t of file.assertionResults ?? file.tasks ?? []) {
        if (t.status === 'passed' || t.result?.state === 'pass') passed++;
        else if (t.status === 'failed' || t.result?.state === 'fail') failed++;
      }
    }
    if (passed === 0 && failed === 0 && report.numPassedTests != null) {
      passed = report.numPassedTests;
      failed = report.numFailedTests ?? 0;
    }
    const total = passed + failed || report.numTotalTests || 0;
    summary = {
      ok: r.status === 0 && failed === 0,
      passed,
      failed,
      total,
      vitestExit: r.status,
    };
  } catch (e) {
    summary = { ok: false, error: String(e), vitestExit: r.status };
  }
} else {
  const tail = (r.stdout || r.stderr || '').slice(-2000);
  summary = { ok: false, error: 'vitest json report missing', vitestExit: r.status, tail };
}

writeFileSync(SUMMARY_OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
process.exit(summary.ok ? 0 : 1);

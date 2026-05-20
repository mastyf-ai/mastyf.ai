#!/usr/bin/env node
/**
 * Enterprise adversarial harness orchestrator.
 * Export rules → matrix + custom fixtures → Python comprehensive eval → Node tests → corpus → parity by id
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..');
const REPORT_DIR = join(__dir, 'reports');
const SUMMARY = join(REPORT_DIR, 'harness-summary.md');

const steps = [];

function run(cmd, args, opts = {}) {
  const label = opts.label ?? [cmd, ...args].join(' ');
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO,
    encoding: 'utf-8',
    env: { ...process.env, ...opts.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  steps.push({
    label,
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').slice(0, 4000),
    stderr: (r.stderr || '').slice(0, 2000),
  });
  return r;
}

function loadJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

mkdirSync(REPORT_DIR, { recursive: true });

console.log('=== Adversarial Harness (enterprise) ===\n');

run('pnpm', ['exec', 'tsx', 'adversarial-harness/scripts/export-harness-rules.ts'], {
  label: 'export-harness-rules',
});

run('node', ['adversarial-harness/scripts/generate-custom-attacks.mjs'], {
  label: 'generate-custom-attacks',
});

run('node', ['adversarial-harness/scripts/generate-matrix-fixtures.mjs'], {
  label: 'generate-matrix-fixtures',
});

run('node', ['adversarial-harness/scripts/export-evasion-attacks.mjs'], {
  label: 'export-evasion-attacks',
});

const venvSetup = run('node', ['adversarial-harness/scripts/setup-python-venv.mjs'], {
  label: 'setup-python-venv',
});
const venvPython = (venvSetup.stdout || '').trim() || 'python3';

run(venvPython, ['adversarial-harness/python/run_comprehensive_eval.py'], {
  label: 'python-comprehensive-eval',
  env: { PYTHONPATH: join(__dir, 'python'), GUARDIAN_DISABLE_SEMANTIC: process.env.GUARDIAN_DISABLE_SEMANTIC || '' },
});

run(venvPython, ['adversarial-harness/python/run_corpus.py'], {
  label: 'python-corpus-only',
  env: { PYTHONPATH: join(__dir, 'python'), GUARDIAN_DISABLE_SEMANTIC: 'true' },
});

run('pnpm', ['build'], { label: 'pnpm-build' });

run('node', ['adversarial-harness/scripts/run-node-tests.mjs'], {
  label: 'node-harness-tests',
});

run('pnpm', ['exec', 'tsx', 'corpus/run-eval.ts'], {
  label: 'node-corpus-eval',
  env: { GUARDIAN_DISABLE_SEMANTIC: process.env.GUARDIAN_DISABLE_SEMANTIC || '' },
});

run('pnpm', ['exec', 'tsx', 'adversarial-harness/scripts/compare-node-python.ts'], {
  label: 'node-python-parity',
  env: {
    PYTHONPATH: join(__dir, 'python'),
    GUARDIAN_DISABLE_SEMANTIC: 'true',
    HARNESS_PYTHON: venvPython,
  },
});

run('node', ['adversarial-harness/scripts/generate-adversarial-report.mjs'], {
  label: 'generate-adversarial-report',
});

const comprehensive = loadJson(join(REPORT_DIR, 'comprehensive-eval.json'));
const parityReport = loadJson(join(REPORT_DIR, 'parity-report.json'));
const corpusReport = loadJson(join(REPO, 'corpus-eval-report.json'));
const nodeTests = loadJson(join(REPORT_DIR, 'node-tests-summary.json'));

const required = [
  'export-harness-rules',
  'generate-custom-attacks',
  'generate-matrix-fixtures',
  'export-evasion-attacks',
  'setup-python-venv',
  'python-comprehensive-eval',
  'node-harness-tests',
  'node-corpus-eval',
  'node-python-parity',
  'generate-adversarial-report',
];
const allOk = required.every((name) => steps.find((s) => s.label === name)?.ok);

const md = `# Adversarial Harness Report

Generated: ${new Date().toISOString()}

## Summary

| Check | Status |
|-------|--------|
| Overall | ${allOk ? 'PASS' : 'FAIL'} |

## Steps

${steps
  .map(
    (s) => `### ${s.label}
- Status: ${s.ok ? 'OK' : 'FAIL'} (exit ${s.status})
${s.stderr ? `\n\`\`\`\n${s.stderr.trim()}\n\`\`\`\n` : ''}`,
  )
  .join('\n')}

## Python Comprehensive Eval

${comprehensive
  ? `- ${comprehensive.pythonPolicyEngine?.summary ?? 'n/a'}
- Corpus loaded: ${comprehensive.corpus?.loaded ?? 0} (attacks on disk: ${comprehensive.corpus?.attacks ?? 0}, benign: ${comprehensive.corpus?.benign ?? 0})
- Matrix: ${comprehensive.matrix?.passed ?? 0}/${comprehensive.matrix?.total ?? 0}
- Duplicate IDs: ${Object.keys(comprehensive.duplicateIds ?? {}).length}
- Failures: ${(comprehensive.failures ?? []).length}`
  : '_No report_'}

## Node Harness Tests

${nodeTests ? `- ${nodeTests.passed}/${nodeTests.total} passed (vitest JSON report)` : '_No report_'}

## Node Corpus Eval

${corpusReport ? `- Entries: ${corpusReport.totalEntries}\n- Passed: ${corpusReport.passed}\n- Attack block rate: ${(corpusReport.attackBlockRate * 100).toFixed(1)}%` : '_No report_'}

## Node ↔ Python Parity (by fixture id)

${parityReport ? `- Agreement: ${parityReport.agreement}/${parityReport.total} (${(parityReport.agreementRate * 100).toFixed(1)}%)\n- Corpus mismatches: ${(parityReport.corpusMismatches ?? []).length}\n- Total mismatches: ${parityReport.mismatches.length}` : '_No report_'}

## Coverage

- Corpus: attacks + benign under \`corpus/\`
- Matrix: 89 isolated category probes (RBAC, rate, token without cross-rule masking)
- Custom: 85+ evasion probes
- Node: AsyncSerialQueue, streaming races, secret scanner, mock MCP proxy
- Parity: string \`id\` keyed \`byId\` maps (no integer index lookup)
`;

writeFileSync(SUMMARY, md);
writeFileSync(
  join(REPORT_DIR, 'harness-summary.json'),
  JSON.stringify({ steps, comprehensive, parityReport, corpusReport, nodeTests, allOk }, null, 2),
);

console.log(`\nReport: ${SUMMARY}`);
process.exit(allOk ? 0 : 1);

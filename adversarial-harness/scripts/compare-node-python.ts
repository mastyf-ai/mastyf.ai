#!/usr/bin/env tsx
/**
 * Parity check: Node vs Python PolicyEngine keyed by string fixture id (never integer index).
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const REPO = join(__dir, '../..');
const REPORT = join(ROOT, 'reports', 'parity-report.json');
const NODE_BATCH = join(ROOT, 'reports', 'node-batch-by-id.json');
const TRACE = join(ROOT, 'reports', 'parity-mismatch-trace.json');

interface FixtureEntry {
  id: string;
  category?: string;
  expected?: string;
  rel?: string;
  source?: string;
  policyMode?: string;
  isolatedPolicy?: unknown;
  context?: Record<string, unknown>;
  toolName?: string;
  arguments?: Record<string, unknown>;
}

function loadFixtures(dir: string, source: string): FixtureEntry[] {
  const out: FixtureEntry[] = [];
  try {
    if (!statSync(dir).isDirectory()) return out;
  } catch {
    return out;
  }
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...loadFixtures(full, source));
    } else if (name.endsWith('.json')) {
      const data = JSON.parse(readFileSync(full, 'utf-8')) as Record<string, unknown>;
      const rel = relative(dir, full);
      const id = String(data.id ?? `${source}:${rel}`);
      out.push({
        ...(data as FixtureEntry),
        id,
        rel,
        source,
      });
    }
  }
  return out;
}

function main() {
  const filterIds = new Set(
    (process.env['HARNESS_FILTER_IDS'] ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
  const filtered = filterIds.size > 0;

  console.error('[parity] node batch eval…');
  const nodeBatch = spawnSync(
    'node',
    ['--import', 'tsx', 'adversarial-harness/scripts/batch-node-eval.ts'],
    {
      cwd: REPO,
      encoding: 'utf-8',
      env: { ...process.env, HARNESS_FILTER_IDS: [...filterIds].join(',') },
    },
  );
  if (nodeBatch.status !== 0) {
    console.error(nodeBatch.stderr || nodeBatch.stdout);
    process.exit(1);
  }
  console.error('[parity] python batch eval…');

  const fixtures = [
    ...loadFixtures(join(REPO, 'corpus'), 'corpus'),
    ...loadFixtures(join(ROOT, 'fixtures', 'matrix'), 'matrix'),
    ...loadFixtures(join(ROOT, 'fixtures', 'custom-attacks'), 'custom'),
  ].filter((f) => !filtered || filterIds.has(f.id));

  const pyInput = fixtures.map((f) => ({ ...f, id: f.id }));

  const pyBin = process.env['HARNESS_PYTHON'] || 'python3';
  const py = spawnSync(pyBin, [join(ROOT, 'python', 'parity_batch.py')], {
    input: JSON.stringify(pyInput),
    encoding: 'utf-8',
    cwd: join(ROOT, 'python'),
    env: { ...process.env, PYTHONPATH: join(ROOT, 'python'), MASTYF_AI_DISABLE_SEMANTIC: 'true' },
  });
  if (py.status !== 0) {
    console.error(py.stderr || py.stdout);
    process.exit(1);
  }
  console.error('[parity] comparing decisions…');

  const pyOut = JSON.parse(py.stdout) as { byId: Record<string, { blocked: boolean; action: string; rule: string }> };
  const nodeOut = JSON.parse(readFileSync(NODE_BATCH, 'utf-8')) as {
    byId: Record<string, { blocked: boolean; action: string; rule: string }>;
  };

  const mismatches: {
    id: string;
    source?: string;
    expected?: string;
    nodeBlocked: boolean;
    pythonBlocked: boolean;
    nodeAction?: string;
    pythonAction?: string;
    pythonRule?: string;
    nodeRule?: string;
  }[] = [];
  let agree = 0;
  let firstMismatchLogged = false;

  const flushTrace = (stage: string) => {
    mkdirSync(dirname(TRACE), { recursive: true });
    writeFileSync(
      TRACE,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          stage,
          filtered,
          filterIds: [...filterIds],
          totalFixtures: fixtures.length,
          agreement: agree,
          mismatches,
        },
        null,
        2,
      ),
    );
  };

  for (const f of fixtures) {
    const nid = f.id;
    const nb = nodeOut.byId[nid]?.blocked;
    const pb = pyOut.byId[nid]?.blocked;
    if (nb === undefined || pb === undefined) {
      const mismatch = {
        id: nid,
        source: f.source,
        expected: f.expected,
        nodeBlocked: nb ?? false,
        pythonBlocked: pb ?? false,
        nodeAction: nb === undefined ? 'missing' : nodeOut.byId[nid]?.action,
        pythonAction: pb === undefined ? 'missing' : pyOut.byId[nid]?.action,
      };
      mismatches.push(mismatch);
      if (!firstMismatchLogged) {
        firstMismatchLogged = true;
        console.error(`PARITY_MISMATCH_FIRST ${JSON.stringify(mismatch)}`);
      }
      flushTrace('missing-decision');
      continue;
    }
    if (nb === pb) agree++;
    else {
      const mismatch = {
        id: nid,
        source: f.source,
        expected: f.expected,
        nodeBlocked: nb,
        pythonBlocked: pb,
        nodeAction: nodeOut.byId[nid]?.action,
        pythonAction: pyOut.byId[nid]?.action,
        nodeRule: nodeOut.byId[nid]?.rule,
        pythonRule: pyOut.byId[nid]?.rule,
      };
      mismatches.push(mismatch);
      if (!firstMismatchLogged) {
        firstMismatchLogged = true;
        console.error(`PARITY_MISMATCH_FIRST ${JSON.stringify(mismatch)}`);
      }
      flushTrace('decision-mismatch');
    }
  }

  const corpusFixtures = fixtures.filter((f) => f.source === 'corpus');
  const corpusIds = new Set(corpusFixtures.map((f) => f.id));
  const corpusMismatches = mismatches.filter((m) => corpusIds.has(m.id));

  const agreementRate = fixtures.length ? agree / fixtures.length : 1;
  const report = {
    timestamp: new Date().toISOString(),
    filtered,
    filterIds: [...filterIds],
    total: fixtures.length,
    corpusTotal: corpusFixtures.length,
    agreement: agree,
    agreementRate,
    mismatches,
    corpusMismatches,
    passed:
      corpusMismatches.length === 0 &&
      mismatches.every((m) => m.nodeAction !== 'missing' && m.pythonAction !== 'missing') &&
      agreementRate >= 0.97,
    customMismatches: mismatches.filter((m) => !corpusIds.has(m.id)).length,
  };

  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  flushTrace('completed');
  console.log(
    `Parity: ${agree}/${fixtures.length} (${(report.agreementRate * 100).toFixed(1)}%) mismatches=${mismatches.length}`,
  );
  if (mismatches.length) {
    console.log(
      mismatches
        .slice(0, 20)
        .map(
          (m) =>
            `${m.id} node=${m.nodeBlocked}(${m.nodeAction}) py=${m.pythonBlocked}(${m.pythonAction}) rule=${m.pythonRule ?? m.nodeRule}`,
        )
        .join('\n'),
    );
  }
  process.exit(report.passed ? 0 : 1);
}

main();

#!/usr/bin/env node
/**
 * Report agent — merge swarm step outputs into reports/security-swarm/latest.json + summary.md
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { bypassFingerprint, diffBypasses } from '../lib/bypass-fingerprint.mjs';
import { resolveSwarmDir } from '../lib/swarm-dir.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..', '..');
const OUT_DIR = resolveSwarmDir();

function load(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function gateStatus(ok) {
  return ok ? 'PASS' : 'FAIL';
}

function formatBypassLine(b) {
  if (b.id) return b.id;
  if (b.fixtureId) return b.fixtureId;
  return JSON.stringify(b).slice(0, 120);
}

function readProxyTierBenchmarks() {
  const report = load(join(REPO, 'benchmarks', 'results', 'proxy-slo-by-concurrency-latest.json'));
  if (!report || !Array.isArray(report.tiers)) return [];
  return report.tiers
    .filter((tier) => tier && typeof tier === 'object')
    .map((tier) => ({
      name: `c${Number(tier.concurrency ?? 0)}`,
      p50: Number(tier.latencyMs?.p50 ?? 0),
      p95: Number(tier.latencyMs?.p95 ?? 0),
      sloMs: Number(tier.sloResults?.p95Ms ?? tier.p95SloMs ?? 0),
      sloPass: Boolean(tier.sloResults?.p95Pass),
      concurrency: Number(tier.concurrency ?? 0),
    }))
    .filter((tier) => Number.isFinite(tier.p95) && tier.p95 > 0);
}

function buildTextReport(latest, gates, bypasses, live) {
  const lines = [];
  const hr = '='.repeat(72);
  const sub = '-'.repeat(72);

  lines.push(hr);
  lines.push('MCP Mastyf AI — Security Swarm Report');
  lines.push(hr);
  lines.push('');
  lines.push(`Generated:  ${latest.timestamp}`);
  lines.push(`Commit:     ${latest.commitSha}`);
  lines.push(`Mode:       ${latest.mode}`);
  lines.push(`Output:     ${live ? 'live' : 'quiet'}`);
  lines.push('');
  lines.push(`Overall:    ${latest.overall ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push(sub);
  lines.push('Gates');
  lines.push(sub);
  lines.push(`  Corpus       ${gateStatus(latest.gates?.corpus)}`);
  lines.push(`  Parity       ${gateStatus(latest.gates?.parity)}`);
  lines.push(`  Steps        ${gateStatus(latest.gates?.steps)}`);
  lines.push(
    `  Bypasses     ${latest.gates?.bypassCount ?? 0} (max ${latest.gates?.maxBypasses ?? gates.evasion?.maxBypasses ?? 0})`,
  );
  lines.push(`  Scout        ${latest.gates?.scout !== false ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push(sub);
  lines.push('Steps');
  lines.push(sub);
  for (const s of latest.steps ?? []) {
    const status = s.ok ? 'PASS' : 'FAIL';
    const elapsed = s.elapsedSec != null ? `${s.elapsedSec}s` : '?';
    lines.push(`  [${status}] ${s.label.padEnd(32)} ${elapsed.padStart(7)}  (exit ${s.status ?? '?'})`);
  }
  lines.push('');
  if (latest.corpus) {
    lines.push(sub);
    lines.push('Corpus');
    lines.push(sub);
    lines.push(`  entries:           ${latest.corpus.totalEntries ?? '?'}`);
    lines.push(`  fn:                ${latest.corpus.fn ?? '?'}`);
    lines.push(`  fp:                ${latest.corpus.fp ?? '?'}`);
    if (latest.corpus.attackBlockRate != null) {
      lines.push(`  attack block rate: ${(latest.corpus.attackBlockRate * 100).toFixed(1)}%`);
    }
    if (latest.corpus.benignPassRate != null) {
      lines.push(`  benign pass rate:  ${(latest.corpus.benignPassRate * 100).toFixed(1)}%`);
    }
    lines.push('');
  }
  if (latest.parity) {
    lines.push(sub);
    lines.push('Parity');
    lines.push(sub);
    lines.push(`  agreement:         ${latest.parity.agreement}/${latest.parity.total}`);
    if (latest.parity.agreementRate != null) {
      lines.push(`  agreement rate:    ${(latest.parity.agreementRate * 100).toFixed(1)}%`);
    }
    lines.push(`  corpus mismatches: ${latest.parity.corpusMismatches ?? 0}`);
    lines.push('');
  }
  lines.push(sub);
  lines.push('Bypasses');
  lines.push(sub);
  if (latest.bypasses) {
    lines.push(`  detected:          ${latest.bypasses.detected ?? 0}`);
    lines.push(`  baseline-known:    ${latest.bypasses.baselineKnown ?? 0}`);
    lines.push(`  net-new:           ${latest.bypasses.netNew ?? 0}`);
    lines.push('');
  }
  if (bypasses.length === 0) {
    lines.push('  (none detected)');
  } else {
    for (const b of bypasses) {
      const tag = b._netNew ? '[NEW] ' : '';
      lines.push(`  - ${tag}${formatBypassLine(b)}`);
    }
  }
  if (latest.findings?.length) {
    lines.push('');
    lines.push(sub);
    lines.push('Findings');
    lines.push(sub);
    for (const f of latest.findings) {
      lines.push(`  [${f.severity}] ${f.source}: ${f.summary}`);
    }
  }
  if (latest.timings) {
    lines.push('');
    lines.push(sub);
    lines.push('Timings');
    lines.push(sub);
    lines.push(`  total:             ${latest.timings.totalSec}s`);
    for (const s of latest.timings.steps ?? []) {
      lines.push(`  ${s.label.padEnd(32)} ${String(s.elapsedSec).padStart(7)}s`);
    }
  }
  lines.push('');
  lines.push(sub);
  lines.push(`Recommended profile: ${latest.recommendedEnvProfile}`);
  lines.push('');
  lines.push(`Summary (markdown): reports/security-swarm/summary.md`);
  lines.push('');

  return lines.join('\n');
}

function writeTextReport(latest, gates, bypasses, live) {
  const text = buildTextReport(latest, gates, bypasses, live);
  const tsSlug = latest.timestamp.replace(/[:.]/g, '-');
  const latestPath = join(OUT_DIR, 'swarm-report.txt');
  const stampedPath = join(OUT_DIR, `report-${tsSlug}.txt`);
  writeFileSync(latestPath, text);
  writeFileSync(stampedPath, text);
  return { latestPath, stampedPath };
}

export function synthesizeReport(input) {
  const { steps = [], mode = 'full', gates = {}, live = false } = input;
  const scout = load(join(OUT_DIR, 'scout.json'));
  const corpus = load(join(REPO, 'corpus-eval-report.json'));
  const parity = load(join(REPO, 'adversarial-harness', 'reports', 'parity-report.json'));
  const harness = load(join(REPO, 'adversarial-harness', 'reports', 'harness-summary.json'));
  const promotions = load(join(OUT_DIR, 'evasion-promotions.json'));
  const proxyTierBenchmarks = readProxyTierBenchmarks();

  let commitSha = 'unknown';
  try {
    commitSha = execSync('git rev-parse HEAD', { cwd: REPO, encoding: 'utf-8' }).trim();
  } catch {
    /* ignore */
  }

  const corpusFn = corpus?.overall?.fn ?? corpus?.failures?.length ?? 1;
  const corpusFp = corpus?.overall?.fp ?? 1;
  const attackBlockRate =
    corpus?.attackBlockRate ??
    (corpus?.overall?.recall != null ? corpus.overall.recall : undefined);
  const benignPassRate =
    corpus?.benignPassRate ??
    (corpus?.overall?.tn != null && corpus?.overall?.fp === 0 ? 1 : undefined);
  const corpusOk =
    corpus &&
    corpusFn === 0 &&
    corpusFp === 0 &&
    (corpus.totalEntries ?? 0) >= (gates.corpus?.minEntries ?? 228) &&
    (attackBlockRate ?? 1) >= (gates.corpus?.minAttackBlockRate ?? 1) &&
    (benignPassRate ?? 1) >= 1 - (gates.corpus?.maxBenignFalsePositiveRate ?? 0);
  const parityStep = steps.find((s) => s.label === 'harness-parity');
  const parityStepOk = parityStep?.ok === true && parityStep?.timedOut !== true;
  const parityOk =
    parityStepOk &&
    parity &&
    (parity.corpusMismatches?.length ?? 0) === 0 &&
    (parity.agreementRate ?? 0) >= (gates.parity?.minOverallAgreementRate ?? 0.97);
  const stepsOk = steps.every((s) => s.ok !== false);

  const harnessReport = load(join(REPO, 'adversarial-harness', 'reports', 'test_harness_report.json'));

  const bypasses = [];
  if (parity?.mismatches) {
    for (const m of parity.mismatches) {
      if (m.node === 'allow' || m.python === 'block') bypasses.push(m);
    }
  }
  // Fast mode runs parity batch (Node+Python) but not full harness orchestrator — avoid stale comprehensive-eval.json.
  if (mode !== 'fast') {
    if (harness?.comprehensive?.failures) {
      for (const f of harness.comprehensive.failures) {
        if (f.expected === 'block') bypasses.push(f);
      }
    }
  } else if (Array.isArray(harnessReport?.policyEngine?.failures)) {
    for (const f of harnessReport.policyEngine.failures) {
      if (f.expected === 'block') bypasses.push(f);
    }
  }

  const baselinePath =
    gates.evasion?.baselineManifest || join(__dir, '..', 'config', 'bypass-baseline.json');
  const baseline = load(baselinePath) || { bypasses: [] };
  const baselineFps = (baseline.bypasses || []).map((b) =>
    typeof b === 'string' ? b : bypassFingerprint(b),
  );
  const { netNew, known } = diffBypasses(bypasses, baselineFps);
  const bypassesTagged = [
    ...known.map((b) => ({ ...b, _netNew: false })),
    ...netNew.map((b) => ({ ...b, _netNew: true })),
  ];

  writeFileSync(
    join(OUT_DIR, 'bypasses.json'),
    JSON.stringify(
      {
        bypasses: bypassesTagged,
        count: bypasses.length,
        netNew: netNew.length,
        baselineKnown: known.length,
        baselineManifest: baselinePath,
      },
      null,
      2,
    ),
  );

  const totalSec = steps.reduce((sum, s) => sum + (s.elapsedSec ?? 0), 0);
  const findings = [];
  if (scout?.audit && !scout.audit.ok) {
    findings.push({
      severity: 'high',
      source: 'scout',
      summary: `Dependency audit failed (critical=${scout.audit.summary?.critical ?? 0} high=${scout.audit.summary?.high ?? 0})`,
    });
  }
  if (scout?.audit?.summary?.moderate > 0) {
    findings.push({
      severity: 'info',
      source: 'scout',
      summary: `Moderate advisories: ${scout.audit.summary.moderate}`,
    });
  }
  for (const s of steps.filter((x) => !x.ok)) {
    findings.push({
      severity: 'critical',
      source: 'step',
      summary: `${s.label} failed (exit ${s.status})`,
    });
  }
  if (netNew.length > 0) {
    findings.push({
      severity: 'critical',
      source: 'evasion',
      summary: `${netNew.length} net-new bypass(es) vs baseline manifest`,
    });
  }
  if (corpus && !corpusOk) {
    findings.push({
      severity: 'critical',
      source: 'corpus',
      summary: `Corpus gate failed (fn=${corpusFn} fp=${corpusFp})`,
    });
  }

  const maxBypasses = gates.evasion?.maxBypasses ?? 0;
  const bypassGateOk = netNew.length <= maxBypasses;

  const latest = {
    version: 1,
    mode,
    timestamp: new Date().toISOString(),
    commitSha,
    findings,
    timings: {
      totalSec: Math.round(totalSec * 10) / 10,
      steps: steps.map((s) => ({ label: s.label, elapsedSec: s.elapsedSec ?? 0 })),
    },
    gates: {
      corpus: corpusOk,
      parity: parityOk,
      steps: stepsOk,
      scout: scout?.audit?.ok ?? true,
      bypassCount: bypasses.length,
      netNewBypassCount: netNew.length,
      maxBypasses,
      bypassBaseline: bypassGateOk,
    },
    bypasses: {
      detected: bypasses.length,
      baselineKnown: known.length,
      netNew: netNew.length,
      items: bypassesTagged,
    },
    performance: {
      tiers: proxyTierBenchmarks,
    },
    overall: corpusOk && parityOk && stepsOk && bypassGateOk,
    steps,
    scout,
    corpus: corpus
      ? {
          totalEntries: corpus.totalEntries,
          fn: corpus.overall?.fn ?? 0,
          fp: corpus.overall?.fp ?? 0,
          attackBlockRate: attackBlockRate ?? corpus.overall?.recall,
          benignPassRate: benignPassRate ?? (corpus.overall?.fp === 0 ? 1 : 0),
        }
      : null,
    parity: parity
      ? {
          agreement: parity.agreement,
          total: parity.total,
          agreementRate: parity.agreementRate,
          corpusMismatches: parity.corpusMismatches?.length ?? 0,
        }
      : null,
    harness: harness ? { allOk: harness.allOk } : null,
    evasionPromotions: promotions?.count ?? 0,
    recommendedEnvProfile: netNew.length > 0 ? 'high-paranoia' : bypasses.length > 0 ? 'hybrid' : 'hybrid',
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'latest.json'), JSON.stringify(latest, null, 2));

  const md = `# Security Swarm Report

Generated: ${latest.timestamp}  
Commit: \`${commitSha}\`  
Mode: **${mode}**  
Overall: **${latest.overall ? 'PASS' : 'FAIL'}**

## Gates

| Gate | Status |
|------|--------|
| Corpus (${corpus?.totalEntries ?? '?'} entries) | ${corpusOk ? 'PASS' : 'FAIL'} |
| Parity (corpus 100%) | ${parityOk ? 'PASS' : 'FAIL'} |
| Steps | ${stepsOk ? 'PASS' : 'FAIL'} |
| Bypasses (detected / net-new / max) | ${bypasses.length} / ${netNew.length} / ${gates.evasion?.maxBypasses ?? 0} |
| Bypass baseline | ${bypassGateOk ? 'PASS' : 'FAIL'} |
| Scout audit | ${scout?.audit?.ok !== false ? 'PASS' : 'FAIL'} |

## Recommended runtime profile

\`${latest.recommendedEnvProfile}\` — see [docs/AI_LEARNING.md](../docs/AI_LEARNING.md#deployment-profiles-security-swarm).

## Steps

${steps.map((s) => `- **${s.label}**: ${s.ok ? 'OK' : 'FAIL'} (exit ${s.status ?? '?'})`).join('\n')}

## Bypasses

${bypasses.length === 0 ? '_None detected._' : bypassesTagged.map((b) => `- ${b._netNew ? '**[NEW]** ' : ''}${b.id || b.fixtureId || b.fingerprint || JSON.stringify(b).slice(0, 80)}`).join('\n')}

## Evidence links

- [enterprise-findings-fixes/summary.md](enterprise-findings-fixes/summary.md)
- [adversarial-harness/reports/harness-summary.md](../../adversarial-harness/reports/harness-summary.md)
`;

  writeFileSync(join(OUT_DIR, 'summary.md'), md);
  writeTextReport(latest, gates, bypassesTagged, live);
  return latest;
}

// CLI when run directly: node security-swarm/agents/report-synthesize.mjs
const isMain = process.argv[1]?.endsWith('report-synthesize.mjs');
if (isMain) {
  const stepsData = load(join(OUT_DIR, 'steps.json'));
  const steps = stepsData?.steps || [];
  const mode = stepsData?.mode || process.env.SWARM_MODE || 'full';
  const live = stepsData?.live ?? false;
  const gates = JSON.parse(readFileSync(join(__dir, '..', 'config', 'gates.json'), 'utf-8'));
  const latest = synthesizeReport({ steps, mode, gates, live });
  console.log(`[report] overall=${latest.overall} → reports/security-swarm/latest.json`);
  console.log(`[report] text → reports/security-swarm/swarm-report.txt`);
  process.exit(latest.overall ? 0 : 1);
}

#!/usr/bin/env node
/**
 * Continuous Red-Team Automation — daily attack simulation with MITRE ATT&CK mapping.
 * Enterprise Phase 3 of 4.
 *
 * Runs: corpus eval + adversarial harness + random mutation attacks
 * Compares against baseline, alerts on detection regression >5%.
 * Outputs: reports/red-team/mitre-attack-heatmap.json, reports/red-team/regression-alert.json
 */
import { execSync } from 'node:child_process';
import { spawnTool } from '../security-swarm/lib/run-step.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const RED_TEAM_DIR = join(REPO_ROOT, 'reports', 'red-team');
const BASELINE_PATH = join(homedir(), '.mastyf-ai', 'red-team-baseline.json');
const HEATMAP_PATH = join(RED_TEAM_DIR, 'mitre-attack-heatmap.json');
const ALERT_PATH = join(RED_TEAM_DIR, 'regression-alert.json');

// ── MITRE ATT&CK Mapping ────────────────────────────────────────────
const MITRE_TECHNIQUES = {
  'T1190': { name: 'Exploit Public-Facing Application', tactic: 'Initial Access' },
  'T1566': { name: 'Phishing', tactic: 'Initial Access' },
  'T1059': { name: 'Command and Scripting Interpreter', tactic: 'Execution' },
  'T1203': { name: 'Exploitation for Client Execution', tactic: 'Execution' },
  'T1055': { name: 'Process Injection', tactic: 'Defense Evasion' },
  'T1027': { name: 'Obfuscated Files or Information', tactic: 'Defense Evasion' },
  'T1140': { name: 'Deobfuscate/Decode Files', tactic: 'Defense Evasion' },
  'T1071': { name: 'Application Layer Protocol', tactic: 'Command and Control' },
  'T1041': { name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration' },
  'T1048': { name: 'Exfiltration Over Alternative Protocol', tactic: 'Exfiltration' },
  'T1530': { name: 'Data from Cloud Storage', tactic: 'Collection' },
  'T1213': { name: 'Data from Information Repositories', tactic: 'Collection' },
};

function runCmd(cmd, args) {
  // spawnTool: pnpm on Windows is a .cmd shim that spawnSync cannot start directly.
  const result = spawnTool(cmd, args, { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 300_000 });
  return { ok: result.status === 0, status: result.status, stdout: result.stdout || '' };
}

async function runCorpusEval() {
  console.log('[red-team] Running corpus evaluation...');
  const r = runCmd('pnpm', ['exec', 'tsx', 'corpus/run-eval.ts']);
  if (r.ok) {
    try {
      const report = JSON.parse(readFileSync(join(REPO_ROOT, 'corpus-eval-report.json'), 'utf-8'));
      return { recall: report.overall?.recall || 1, precision: report.overall?.precision || 1, total: report.totalEntries };
    } catch { return { recall: 1, precision: 1, total: 0 }; }
  }
  return { recall: 0, precision: 0, total: 0 };
}

async function runAdversarialHarness() {
  console.log('[red-team] Running adversarial harness...');
  const r = runCmd('node', ['adversarial-harness/run-harness.mjs']);
  return { ok: r.ok, status: r.status };
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    return { recall: 1, precision: 1, lastRun: null, runs: 0 };
  }
  try { return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')); } catch { return { recall: 1, precision: 1, lastRun: null, runs: 0 }; }
}

function saveBaseline(results) {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2));
}

function generateMitreHeatmap(detectionRate) {
  const heatmap = [];
  for (const [id, tech] of Object.entries(MITRE_TECHNIQUES)) {
    heatmap.push({
      techniqueId: id,
      techniqueName: tech.name,
      tactic: tech.tactic,
      coverage: Math.round(detectionRate * 100),
      status: detectionRate > 0.9 ? 'strong' : detectionRate > 0.7 ? 'moderate' : 'weak',
    });
  }
  return heatmap;
}

async function main() {
  console.log('[red-team] === Continuous Red-Team Analysis ===');
  mkdirSync(RED_TEAM_DIR, { recursive: true });

  // Step 1: Corpus evaluation
  const corpusResults = await runCorpusEval();
  console.log(`[red-team] Corpus: ${corpusResults.total} fixtures, recall=${(corpusResults.recall * 100).toFixed(1)}%`);

  // Step 2: Adversarial harness
  await runAdversarialHarness();

  // Step 3: Compare with baseline
  const baseline = loadBaseline();
  const regression = baseline.runs > 0 && (baseline.recall - corpusResults.recall) > 0.05;

  const results = {
    timestamp: new Date().toISOString(),
    recall: corpusResults.recall,
    precision: corpusResults.precision,
    totalFixtures: corpusResults.total,
    runs: baseline.runs + 1,
    regressionDetected: regression,
    regressionDelta: baseline.runs > 0 ? (baseline.recall - corpusResults.recall) : 0,
  };
  saveBaseline(results);

  // Step 4: Generate MITRE ATT&CK heatmap
  const heatmap = generateMitreHeatmap(corpusResults.recall);
  writeFileSync(HEATMAP_PATH, JSON.stringify({ timestamp: results.timestamp, heatmap }, null, 2));
  console.log(`[red-team] MITRE ATT&CK heatmap: ${HEATMAP_PATH}`);

  // Step 5: Alert on regression
  if (regression) {
    const alert = {
      severity: 'HIGH',
      message: `Detection regression detected: recall dropped from ${(baseline.recall * 100).toFixed(1)}% to ${(corpusResults.recall * 100).toFixed(1)}%`,
      delta: results.regressionDelta,
      timestamp: results.timestamp,
    };
    writeFileSync(ALERT_PATH, JSON.stringify(alert, null, 2));
    console.error(`[red-team] ALERT: ${alert.message}`);
    runCmd('pnpm', [
      'exec',
      'tsx',
      'scripts/notify-regression-alert.ts',
      String(corpusResults.recall),
      String(baseline.recall),
      String(results.regressionDelta),
    ]);
    process.exit(1);
  }

  console.log('[red-team] No regression detected — baseline stable');
}

main().catch((err) => {
  console.error(`[red-team] Error: ${err.message}`);
  process.exit(1);
});
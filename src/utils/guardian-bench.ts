/**
 * Guardian Benchmark — scorecard from adversarial harness and security-swarm reports.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { IndustryStandardStore } from '../database/industry-standard-store.js';

export interface BenchmarkScorecard {
  profile: string;
  generatedAt: string;
  blockRate: number;
  falsePositiveRate: number;
  p95LatencyMs?: number;
  corpusEntries?: number;
  parityAgreement?: number;
  harnessPassed?: boolean;
  sources: string[];
  summary: string;
}

function loadJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function runGuardianBenchScorecard(
  reportsDir = join(process.cwd(), 'reports'),
  profile = 'default',
): BenchmarkScorecard {
  const sources: string[] = [];
  let blockRate = 0;
  let falsePositiveRate = 0;
  let p95LatencyMs: number | undefined;
  let corpusEntries: number | undefined;
  let parityAgreement: number | undefined;
  let harnessPassed: boolean | undefined;

  const harnessResults = loadJson(join(reportsDir, 'adversarial-harness', 'results.json'));
  if (harnessResults) {
    sources.push('reports/adversarial-harness/results.json');
    const corpus = harnessResults.corpus as Record<string, number> | undefined;
    if (corpus) {
      blockRate = corpus.recall ?? corpus.attacksBlocked! / Math.max(corpus.attacksTotal ?? 1, 1);
      falsePositiveRate = 1 - (corpus.benignPassRate ?? 1);
      corpusEntries = corpus.totalEntries;
    }
    const parity = harnessResults.parity as Record<string, number> | undefined;
    if (parity) parityAgreement = parity.agreementRate;
    harnessPassed = Boolean(harnessResults.overallPassed);
    const latency = (harnessResults.nodeIntegration as Record<string, unknown> | undefined)?.concurrency as
      | Record<string, unknown>
      | undefined;
    p95LatencyMs = (latency?.p95Ms as number | undefined) ??
      ((latency?.proxy as Record<string, number> | undefined)?.p95Ms);
  }

  const swarm = loadJson(join(reportsDir, 'security-swarm', 'latest.json'));
  if (swarm) {
    sources.push('reports/security-swarm/latest.json');
    const corpus = swarm.corpus as Record<string, number> | undefined;
    if (corpus) {
      blockRate = corpus.attackBlockRate ?? blockRate;
      falsePositiveRate = 1 - (corpus.benignPassRate ?? 1);
      corpusEntries = corpus.totalEntries ?? corpusEntries;
    }
    const parity = swarm.parity as Record<string, number> | undefined;
    if (parity) parityAgreement = parity.agreementRate ?? parityAgreement;
    harnessPassed = (swarm.harness as Record<string, boolean> | undefined)?.allOk ?? harnessPassed;
  }

  const harnessSummary = loadJson(join(process.cwd(), 'adversarial-harness', 'reports', 'harness-summary.json'));
  if (harnessSummary) {
    sources.push('adversarial-harness/reports/harness-summary.json');
    harnessPassed = Boolean(harnessSummary.allOk ?? harnessPassed);
  }

  return {
    profile,
    generatedAt: new Date().toISOString(),
    blockRate: Math.round(blockRate * 1000) / 1000,
    falsePositiveRate: Math.round(falsePositiveRate * 1000) / 1000,
    p95LatencyMs,
    corpusEntries,
    parityAgreement,
    harnessPassed,
    sources,
    summary: `Block rate ${(blockRate * 100).toFixed(1)}%, FP rate ${(falsePositiveRate * 100).toFixed(1)}% from ${sources.length} report(s)`,
  };
}

export function persistBenchmarkScorecard(
  store: IndustryStandardStore,
  scorecard: BenchmarkScorecard,
  packageName?: string,
): void {
  store.saveBenchmarkSubmission({
    id: `bench-${Date.now()}`,
    profile: scorecard.profile,
    packageName,
    blockRate: scorecard.blockRate,
    falsePositiveRate: scorecard.falsePositiveRate,
    p95LatencyMs: scorecard.p95LatencyMs,
    scorecardJson: JSON.stringify(scorecard),
    submittedAt: scorecard.generatedAt,
  });
}

/** Optionally run adversarial harness before scoring (GUARDIAN_BENCH_RUN_HARNESS=true). */
export async function runHarnessThenScorecard(
  reportsDir = join(process.cwd(), 'reports'),
  profile = 'default',
): Promise<BenchmarkScorecard> {
  if (process.env.GUARDIAN_BENCH_RUN_HARNESS === 'true') {
    const { spawnSync } = await import('child_process');
    const result = spawnSync('node', ['adversarial-harness/run-harness.mjs'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: { ...process.env, GUARDIAN_REPORTS_DIR: reportsDir },
    });
    if (result.status !== 0) {
      throw new Error(`Harness exited with code ${result.status ?? 'unknown'}`);
    }
  }
  return runGuardianBenchScorecard(reportsDir, profile);
}

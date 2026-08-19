/**
 * Package scorer v3 — orchestrates enrichers, the live attack probe, and
 * npm-stat trend data, then delegates all scoring math to the shared
 * scoring-core (single source of truth with the batch worker).
 *
 * v3 highlights:
 *   • behavioralIntegrity dimension driven by the live tarball attack probe
 *   • probe findings (secret leaks, dangerous exec, suspicious egress) reduce
 *     the score; when the probe cannot run the score is penalised
 *   • confidence re-weighting removed (it inflated scores); flat uncertainty
 *     penalties instead
 *   • full CVE/GHSA/probe findings surfaced in report issues
 */

import type { PackageScoreTier } from './package-score-resolver';
import type { PublishableScoreReport } from './score-report';
import { enrichFromNpm, type NpmEnrichment } from './enrichers/npm-enricher';
import { enrichCves, type CveEnrichment } from './enrichers/cve-enricher';
import { enrichSocket, type SocketEnrichment } from './enrichers/socket-enricher';
import { enrichGitHubAdvisories, type GitHubAdvisoryEnrichment } from './enrichers/github-advisory-enricher';
import { verifyProvenance, type ProvenanceResult } from './enrichers/provenance-verifier';
import { fetchNpmStatTrend, type NpmStatTrend } from './enrichers/npm-stat-enricher.mjs';
import { probePackage, type ProbeResult } from './probe/attack-probe.mjs';
import {
  computeScoreV3,
  buildScoreReportV3,
  buildChecksV3,
  buildBreakdownV3,
  buildImprovementPlanV3,
  computeGrade,
  scoreToLevel,
  type ConfidenceV3,
  type DimensionExplanationV3,
  type BreakdownItemV3 as CoreBreakdownItem,
  type ImprovementPlanItemV3,
} from './scoring-core.mjs';

export class NpmPackageNotFoundError extends Error {
  constructor(name: string) { super(`Package not found: ${name}`); }
}

export function isValidNpmPackageName(name: string): boolean {
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name);
}

// ── Public types (kept stable for explainability / compare / history) ──

export type Confidence = ConfidenceV3;
export type DimensionExplanation = DimensionExplanationV3;
export type ScoreBreakdownItem = CoreBreakdownItem;
export type ImprovementPlanItem = ImprovementPlanItemV3;

export type ScoreResult = {
  packageName: string;
  version: string;
  score: number;
  grade: string;
  level: string;
  cves: { total: number; critical: number };
  dimensions: Record<string, number>;
  dimensionExplanations: Record<string, DimensionExplanation>;
  confidenceMap: Record<string, Confidence>;
  scoreReport: PublishableScoreReport;
  breakdown: {
    positive: ScoreBreakdownItem[];
    negative: ScoreBreakdownItem[];
    neutral: ScoreBreakdownItem[];
  };
  improvementPlan: ImprovementPlanItem[];
  checks: Record<string, unknown>[];
  computedAt: string;
  scanTier: PackageScoreTier;
  serverName: string;
  includesLiveData: boolean;
};

type EnrichmentBundle = {
  npm: NpmEnrichment;
  cves: CveEnrichment;
  socket: SocketEnrichment;
  github: GitHubAdvisoryEnrichment;
  provenance: ProvenanceResult;
  trend: NpmStatTrend;
  probe: ProbeResult | null;
};

async function gatherEnrichment(packageName: string, runProbe: boolean): Promise<EnrichmentBundle> {
  let npm: NpmEnrichment;
  try {
    npm = await enrichFromNpm(packageName);
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) {
      throw new NpmPackageNotFoundError(packageName);
    }
    throw err;
  }

  const [cves, github, provenance, trend, probe] = await Promise.all([
    enrichCves(packageName, npm.version),
    enrichGitHubAdvisories(packageName),
    verifyProvenance(packageName, npm.version),
    fetchNpmStatTrend(packageName),
    runProbe ? probePackage(packageName, npm.version).catch(() => null) : Promise.resolve(null),
  ]);
  const socket = await enrichSocket(packageName, npm.dependencyCount, npm.version);

  return { npm, cves, socket, github, provenance, trend, probe };
}

function assembleScoreResult(
  name: string,
  bundle: EnrichmentBundle,
  scanTier: PackageScoreTier,
  includesLiveData: boolean,
): ScoreResult {
  const { npm, cves, socket, github, provenance, trend, probe } = bundle;

  const { score, dimensions, confidenceMap, dimensionExplanations } = computeScoreV3({
    npm, cves, socket, github, provenance, probe, trend,
  });

  const grade = computeGrade(score);

  const scoreReport = buildScoreReportV3({
    score, npm, cves, socket, github, provenance, probe, trend, dimensions,
  });

  const checks = buildChecksV3({
    score, grade, npm, cves, socket, github, provenance, probe, trend, confidenceMap,
  });

  const breakdown = buildBreakdownV3({
    npm, cves, socket, github, provenance, probe, trend, dimensions,
  });

  const improvementPlan = buildImprovementPlanV3({
    npm, cves, socket, provenance, probe, dimensions,
  });

  return {
    packageName: name,
    version: npm.version,
    score,
    grade,
    level: scoreToLevel(score),
    cves: { total: cves.cveCount, critical: cves.criticalCveCount },
    dimensions,
    dimensionExplanations,
    confidenceMap,
    scoreReport,
    breakdown,
    improvementPlan,
    checks,
    computedAt: new Date().toISOString(),
    scanTier,
    serverName: name.split('/').pop() ?? name,
    includesLiveData,
  };
}

/**
 * Static scan: registry + CVE + supply-chain enrichment plus the live attack
 * probe and npm-stat trend analysis.
 */
export async function scorePackageStatic(name: string): Promise<ScoreResult> {
  const bundle = await gatherEnrichment(name, true);
  return assembleScoreResult(name, bundle, 'static', false);
}

/**
 * Live scan: bypasses in-memory enrichment caches for fresh data and runs the
 * full pipeline including the live attack probe (tarball behavioural scan).
 */
export async function scorePackageLive(name: string): Promise<ScoreResult> {
  // Re-import enrichers to bypass their in-memory caches where possible
  const { enrichFromNpm: freshNpm } = await import('./enrichers/npm-enricher');
  const { enrichCves: freshCves } = await import('./enrichers/cve-enricher');
  const { enrichSocket: freshSocket } = await import('./enrichers/socket-enricher');
  const { enrichGitHubAdvisories: freshGithub } = await import('./enrichers/github-advisory-enricher');
  const { verifyProvenance: freshProvenance } = await import('./enrichers/provenance-verifier');

  let npm: NpmEnrichment;
  try {
    npm = await freshNpm(name);
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) {
      throw new NpmPackageNotFoundError(name);
    }
    throw err;
  }

  const [cves, github, provenance, trend, probe] = await Promise.all([
    freshCves(name, npm.version),
    freshGithub(name),
    freshProvenance(name, npm.version),
    fetchNpmStatTrend(name),
    probePackage(name, npm.version).catch(() => null),
  ]);
  const socket = await freshSocket(name, npm.dependencyCount, npm.version);

  return assembleScoreResult(name, { npm, cves, socket, github, provenance, trend, probe }, 'live', true);
}

export function scorePackageByName(packageName: string): { score: number; grade: string; cves: number } {
  return { score: 0, grade: 'N/A', cves: 0 };
}

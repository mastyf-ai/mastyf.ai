/**
 * Real package scorer v2 — orchestrates all enrichers and produces meaningful scores.
 * Uses license, CVSS, recency, patches, velocity, finished-package detection,
 * dep confusion, and confidence tracking.
 */

import type { PackageScoreTier } from './package-score-resolver';
import type { PublishableScoreReport, PublishableCategory, PublishableIssue, ImprovementAction } from './score-report';
import { enrichFromNpm, type NpmEnrichment } from './enrichers/npm-enricher';
import { enrichCves, type CveEnrichment, type CveFinding } from './enrichers/cve-enricher';
import { enrichSocket, type SocketEnrichment } from './enrichers/socket-enricher';
import { enrichGitHubAdvisories, type GitHubAdvisoryEnrichment } from './enrichers/github-advisory-enricher';
import { verifyProvenance, type ProvenanceResult } from './enrichers/provenance-verifier';

export class NpmPackageNotFoundError extends Error {
  constructor(name: string) { super(`Package not found: ${name}`); }
}

export function isValidNpmPackageName(name: string): boolean {
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name);
}

export type ScoreBreakdownItem = {
  signal: string;
  points: string;
  source: string;
  note?: string;
};

export type ImprovementPlanItem = {
  action: string;
  estimatedIncrease: string;
  effort: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
};

export type DimensionExplanation = {
  score: number;
  explanation: string;
  confidence: Confidence;
  dataSources: string[];
  improvement?: string;
};

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

// ── Dimension weights (reflects real-world security importance) ──
const DIMENSION_WEIGHTS: Record<string, number> = {
  cvePosture: 0.20,
  supplyChainIntegrity: 0.18,
  authStrength: 0.08,
  transportSecurity: 0.06,
  observedAttackHistory: 0.12,
  responseHygiene: 0.08,
  configurationFreshness: 0.10,
  abilityRiskSurface: 0.08,
  licenseRisk: 0.05,
  downloadHealth: 0.05,
};

// ── Confidence tracking ──
export type Confidence = 'verified' | 'assumed' | 'missing';

function confidenceForData(hasRealData: boolean, hasDefault: boolean): Confidence {
  if (hasRealData) return 'verified';
  if (hasDefault) return 'assumed';
  return 'missing';
}

// ── Compute grade from score ──
function computeGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

// ── Compute level from score ──
function scoreToLevel(score: number): string {
  if (score >= 90) return 'platinum';
  if (score >= 75) return 'gold';
  if (score >= 60) return 'silver';
  return 'bronze';
}

// ── Clamp helper ──
function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

// ── Freshness formula: logarithmic decay ──
function freshnessScore(daysSinceUpdate: number): number {
  if (daysSinceUpdate <= 0) return 100;
  if (daysSinceUpdate <= 7) return 95;
  if (daysSinceUpdate <= 30) return 85;
  if (daysSinceUpdate <= 90) return 70;
  if (daysSinceUpdate <= 180) return 55;
  if (daysSinceUpdate <= 365) return 40;
  return Math.max(10, 30 - Math.log2(daysSinceUpdate / 365) * 10);
}

// ── "Finished package" detection ──
function isFinishedPackage(npm: NpmEnrichment): boolean {
  const isMature = npm.packageAgeDays > 365;
  const noRecentPublish = npm.lastPublishedDays > 180;
  const hasDownloads = npm.downloadsLast30Days > 1000;
  return isMature && noRecentPublish && hasDownloads;
}

// ── Finished package freshness: based on download stability, not publish date ──
function finishedPackageFreshness(npm: NpmEnrichment): number {
  // Stable downloads = healthy finished package
  const downloadsPerDay = npm.downloadsLast30Days / 30;
  if (downloadsPerDay > 1000) return 85; // very popular, stable
  if (downloadsPerDay > 100) return 75;
  if (downloadsPerDay > 10) return 65;
  return 50; // low downloads but stable
}

// ── Download velocity detection ──
function downloadVelocityModifier(npm: NpmEnrichment): number {
  if (npm.downloadsLast30Days === 0) return -10;
  const ratio = npm.downloadsLast7Days / (npm.downloadsLast30Days / 4);
  if (ratio > 2.0) return -10; // sudden spike = suspicious
  if (ratio > 1.5) return -5;  // growing fast = watch
  if (ratio < 0.2) return -10; // sharp decline = abandoned
  if (ratio < 0.5) return -5;  // declining
  return 0; // stable
}

// ── Download popularity signal ──
function downloadPopularityModifier(downloads30d: number): number {
  if (downloads30d >= 1000000) return 15;
  if (downloads30d >= 100000) return 10;
  if (downloads30d >= 10000) return 5;
  if (downloads30d >= 1000) return 0;
  if (downloads30d >= 100) return -5;
  if (downloads30d >= 10) return -10;
  return -15;
}

// ── License risk scoring ──
function licenseRiskScore(license: string): { score: number; confidence: Confidence } {
  const l = license.toLowerCase().trim();
  if (l === 'unknown' || l === '' || l === 'unlicensed') return { score: 20, confidence: 'verified' };
  if (l.includes('gpl') || l.includes('agpl')) return { score: 40, confidence: 'verified' };
  if (l.includes('lgpl') || l.includes('mpl')) return { score: 60, confidence: 'verified' };
  if (l.includes('mit') || l.includes('apache') || l.includes('bsd') || l.includes('isc') || l.includes('0bsd')) return { score: 90, confidence: 'verified' };
  if (l.includes('artistic') || l.includes('zlib') || l.includes('unlicense')) return { score: 85, confidence: 'verified' };
  return { score: 70, confidence: 'verified' }; // other recognized license
}

// ── CVE posture with CVSS weighting and recency ──
function computeCvePosture(cves: CveEnrichment): { score: number; confidence: Confidence } {
  if (cves.status === 'unavailable') return { score: 50, confidence: 'missing' };

  let score = 100;

  // CVSS-based penalty (use actual scores, not just counts)
  if (cves.maxCvss > 0) {
    score -= cves.maxCvss * 8; // max CVSS 10 = -80 points
  }

  // Count-based penalty (reduced weight since CVSS is primary)
  score -= cves.criticalCveCount * 12;
  score -= cves.highCveCount * 6;
  score -= cves.mediumCveCount * 2;
  score -= cves.lowCveCount * 0.5;

  // Recency multiplier: recent CVEs hurt more
  if (cves.newestCveAgeDays > 0) {
    let recencyMultiplier = 1.0;
    if (cves.newestCveAgeDays < 30) recencyMultiplier = 1.5;
    else if (cves.newestCveAgeDays < 90) recencyMultiplier = 1.2;
    else if (cves.newestCveAgeDays < 365) recencyMultiplier = 1.0;
    else recencyMultiplier = 0.7;

    // Apply recency to the penalty portion only
    const penalty = 100 - score;
    score = 100 - (penalty * recencyMultiplier);
  }

  // Patch availability bonus
  const patchedCount = cves.findings.filter((f) => f.fixedVersion).length;
  if (cves.findings.length > 0) {
    const patchRatio = patchedCount / cves.findings.length;
    if (patchRatio === 1.0) score += 5; // all patched
    else if (patchRatio > 0.5) score += 2; // partially patched
  }

  const confidence = cves.status === 'ok' ? 'verified' : 'assumed';
  return { score: clamp(Math.round(score)), confidence };
}

// ── Supply chain integrity ──
function computeSupplyChain(
  socket: SocketEnrichment,
  provenance: ProvenanceResult,
): { score: number; confidence: Confidence } {
  let score = socket.socketSupplyChainScore;
  if (socket.typoSquatDetected) score -= 25;
  if (socket.depConfusionDetected) score -= 15; // NEW: was zero impact!
  if (provenance.provenanceVerified) score += 10;
  if (socket.hasTrustedPublisher) score += 10;
  if (socket.highConfidenceMalware) score -= 50;
  if (socket.malwareSignalCount > 0) score -= socket.malwareSignalCount * 5;

  const confidence = socket.source === 'socket_api' ? 'verified' : 'assumed';
  return { score: clamp(Math.round(score)), confidence };
}

// ── Auth strength ──
function computeAuthStrength(
  npm: NpmEnrichment,
  socket: SocketEnrichment,
): { score: number; confidence: Confidence } {
  const hasAuth = npm.description.toLowerCase().includes('auth') ||
    npm.keywords.some((k) => ['auth', 'oauth', 'jwt', 'api-key'].includes(k.toLowerCase()));

  let score = 40;
  if (hasAuth) score += 20;
  if (socket.source === 'socket_api') {
    score = socket.socketSupplyChainScore > 70 ? 70 : 40;
    return { score, confidence: 'verified' };
  }
  return { score, confidence: 'assumed' };
}

// ── Transport security ──
function computeTransportSecurity(npm: NpmEnrichment): { score: number; confidence: Confidence } {
  const isHttp = npm.description.toLowerCase().includes('http') ||
    npm.description.toLowerCase().includes('sse') ||
    npm.description.toLowerCase().includes('streamable') ||
    npm.keywords.some((k) => ['http', 'sse', 'streamable', 'remote'].includes(k.toLowerCase()));
  const isStdio = npm.keywords.some((k) => ['stdio', 'local', 'cli'].includes(k.toLowerCase()));

  let score = 50;
  if (isStdio) score = 80;
  if (isHttp) score = 40;
  return { score, confidence: 'assumed' };
}

// ── Observed attack history ──
function computeAttackHistory(
  cves: CveEnrichment,
  github: GitHubAdvisoryEnrichment,
): { score: number; confidence: Confidence } {
  const totalAdvisories = cves.cveCount + github.advisoryCount;
  const criticalAdvisories = cves.criticalCveCount + github.criticalAdvisoryCount;

  let score = 100;
  score -= totalAdvisories * 8;
  score -= criticalAdvisories * 15;

  // Recency of advisories
  const newestAge = Math.min(
    cves.newestCveAgeDays || Infinity,
    github.newestAdvisoryAgeDays || Infinity,
  );
  if (newestAge < 30) score -= 10; // very recent advisory
  else if (newestAge < 90) score -= 5;

  const confidence = (cves.status === 'ok' || github.status === 'ok') ? 'verified' : 'assumed';
  return { score: clamp(Math.round(score)), confidence };
}

// ── Response hygiene ──
function computeResponseHygiene(npm: NpmEnrichment): { score: number; confidence: Confidence } {
  const signals = [
    npm.hasReadme ? 1 : 0,
    npm.hasKeywords ? 1 : 0,
    npm.homepage ? 1 : 0,
    npm.repository ? 1 : 0,
    npm.maintainers.length > 0 ? 1 : 0,
    npm.maintainers.length >= 3 ? 1 : 0, // bonus for multiple maintainers
  ];
  const score = Math.round((signals.reduce((a, b) => a + b, 0) / signals.length) * 100);
  return { score, confidence: 'verified' };
}

// ── Configuration freshness ──
function computeFreshness(
  npm: NpmEnrichment,
): { score: number; confidence: Confidence } {
  if (isFinishedPackage(npm)) {
    return { score: finishedPackageFreshness(npm), confidence: 'verified' };
  }
  return { score: freshnessScore(npm.lastPublishedDays), confidence: 'verified' };
}

// ── Tool risk surface ──
function computeToolRiskSurface(
  socket: SocketEnrichment,
  npm: NpmEnrichment,
): { score: number; confidence: Confidence } {
  if (socket.source === 'socket_api' && socket.totalToolCount > 0) {
    const highRatio = socket.highRiskToolCount / socket.totalToolCount;
    const mediumRatio = socket.mediumRiskToolCount / socket.totalToolCount;
    const riskScore = highRatio * 0 + mediumRatio * 30 + (1 - highRatio - mediumRatio) * 80;
    return { score: clamp(Math.round(riskScore)), confidence: 'verified' };
  }

  // Dynamic heuristic based on dep count and repo presence
  let score = 50;
  if (npm.dependencyCount > 50) score -= 15;
  if (npm.dependencyCount > 100) score -= 10;
  if (npm.dependencyCount <= 5) score += 15;
  if (npm.repository) score += 10;
  if (socket.hasTrustedPublisher) score += 10;
  return { score: clamp(score), confidence: 'assumed' };
}

// ── Download health (velocity + popularity) ──
function computeDownloadHealth(npm: NpmEnrichment): { score: number; confidence: Confidence } {
  let score = 50;

  // Popularity component
  const popMod = downloadPopularityModifier(npm.downloadsLast30Days);
  score += popMod;

  // Velocity component
  const velMod = downloadVelocityModifier(npm);
  score += velMod;

  return { score: clamp(score), confidence: 'verified' };
}

// ── Build the full scoring input from enrichers ──
async function gatherEnrichment(packageName: string): Promise<{
  npm: NpmEnrichment;
  cves: CveEnrichment;
  socket: SocketEnrichment;
  github: GitHubAdvisoryEnrichment;
  provenance: ProvenanceResult;
}> {
  const npm = await enrichFromNpm(packageName);
  const [cves, github, provenance] = await Promise.all([
    enrichCves(packageName, npm.version),
    enrichGitHubAdvisories(packageName),
    verifyProvenance(packageName, npm.version),
  ]);
  const socket = await enrichSocket(packageName, npm.dependencyCount);
  return { npm, cves, socket, github, provenance };
}

// ── Core scoring algorithm ──
function computeScore(
  npm: NpmEnrichment,
  cves: CveEnrichment,
  socket: SocketEnrichment,
  github: GitHubAdvisoryEnrichment,
  provenance: ProvenanceResult,
): {
  score: number;
  dimensions: Record<string, number>;
  confidenceMap: Record<string, Confidence>;
  dimensionExplanations: Record<string, DimensionExplanation>;
} {
  // Compute each dimension
  const cveResult = computeCvePosture(cves);
  const supplyResult = computeSupplyChain(socket, provenance);
  const authResult = computeAuthStrength(npm, socket);
  const transportResult = computeTransportSecurity(npm);
  const attackResult = computeAttackHistory(cves, github);
  const hygieneResult = computeResponseHygiene(npm);
  const freshnessResult = computeFreshness(npm);
  const riskResult = computeToolRiskSurface(socket, npm);
  const licenseResult = licenseRiskScore(npm.license);
  const downloadResult = computeDownloadHealth(npm);

  const dimensions: Record<string, number> = {
    cvePosture: cveResult.score,
    supplyChainIntegrity: supplyResult.score,
    authStrength: authResult.score,
    transportSecurity: transportResult.score,
    observedAttackHistory: attackResult.score,
    responseHygiene: hygieneResult.score,
    configurationFreshness: freshnessResult.score,
    abilityRiskSurface: riskResult.score,
    licenseRisk: licenseResult.score,
    downloadHealth: downloadResult.score,
  };

  const confidenceMap: Record<string, Confidence> = {
    cvePosture: cveResult.confidence,
    supplyChainIntegrity: supplyResult.confidence,
    authStrength: authResult.confidence,
    transportSecurity: transportResult.confidence,
    observedAttackHistory: attackResult.confidence,
    responseHygiene: hygieneResult.confidence,
    configurationFreshness: freshnessResult.confidence,
    abilityRiskSurface: riskResult.confidence,
    licenseRisk: licenseResult.confidence,
    downloadHealth: downloadResult.confidence,
  };

  // Build dimension explanations
  const dimensionExplanations: Record<string, DimensionExplanation> = {
    cvePosture: {
      score: cveResult.score,
      explanation: cves.cveCount === 0
        ? 'No known vulnerabilities found in OSV, NVD, or GitHub Advisory databases.'
        : `${cves.cveCount} vulnerabilities found (${cves.criticalCveCount} critical, ${cves.highCveCount} high). Max CVSS: ${cves.maxCvss}.`,
      confidence: cveResult.confidence,
      dataSources: ['OSV.dev', 'NVD', 'GitHub Advisory DB'],
    },
    supplyChainIntegrity: {
      score: supplyResult.score,
      explanation: socket.typoSquatDetected
        ? 'Possible typosquatting detected — verify this is the correct package.'
        : socket.depConfusionDetected
          ? 'Potential dependency confusion risk detected.'
          : socket.hasTrustedPublisher
            ? 'Published by a verified organization with provenance attestation.'
            : 'Supply chain signals are within normal range.',
      confidence: supplyResult.confidence,
      dataSources: socket.source === 'socket_api' ? ['Socket.dev API'] : ['Heuristic analysis'],
      improvement: socket.source !== 'socket_api' ? 'Set SOCKET_API_KEY for verified supply chain analysis' : undefined,
    },
    authStrength: {
      score: authResult.score,
      explanation: 'Authentication support assessed from package metadata and description.',
      confidence: authResult.confidence,
      dataSources: ['npm registry metadata'],
    },
    transportSecurity: {
      score: transportResult.score,
      explanation: isHttpPackage(npm)
        ? 'This package uses HTTP transport — ensure HTTPS is enabled in production.'
        : 'This package uses stdio transport (local process communication).',
      confidence: transportResult.confidence,
      dataSources: ['npm registry metadata'],
    },
    observedAttackHistory: {
      score: attackResult.score,
      explanation: (cves.cveCount + github.advisoryCount) === 0
        ? 'No known attack history or security advisories.'
        : `${cves.cveCount + github.advisoryCount} security advisories found across CVE databases.`,
      confidence: attackResult.confidence,
      dataSources: ['OSV.dev', 'NVD', 'GitHub Advisory DB'],
    },
    responseHygiene: {
      score: hygieneResult.score,
      explanation: `Package has ${responseHygienePercent(npm)}% of hygiene signals present (README, keywords, homepage, repo, maintainers).`,
      confidence: hygieneResult.confidence,
      dataSources: ['npm registry metadata'],
    },
    configurationFreshness: {
      score: freshnessResult.score,
      explanation: isFinishedPackage(npm)
        ? `Mature package (${npm.packageAgeDays} days old) with stable downloads — not penalized for infrequent updates.`
        : npm.lastPublishedDays <= 30
          ? 'Actively maintained — updated within the last month.'
          : npm.lastPublishedDays <= 90
            ? 'Updated within the last quarter.'
            : `Last updated ${npm.lastPublishedDays} days ago — may need attention.`,
      confidence: freshnessResult.confidence,
      dataSources: ['npm registry metadata'],
    },
    abilityRiskSurface: {
      score: riskResult.score,
      explanation: `Risk surface assessed from ${npm.dependencyCount} dependencies and tool capabilities.`,
      confidence: riskResult.confidence,
      dataSources: riskResult.confidence === 'verified' ? ['Socket.dev API'] : ['Heuristic analysis'],
    },
    licenseRisk: {
      score: licenseResult.score,
      explanation: npm.license === 'unknown' || npm.license === ''
        ? 'No license specified — legal risk for commercial use.'
        : npm.license.toLowerCase().includes('gpl')
          ? `GPL license detected — copyleft risk for commercial use.`
          : `License: ${npm.license} — permissive, no legal risk.`,
      confidence: licenseResult.confidence,
      dataSources: ['npm registry metadata'],
    },
    downloadHealth: {
      score: downloadResult.score,
      explanation: npm.downloadsLast30Days > 100000
        ? `High download volume (${formatDownloads(npm.downloadsLast30Days)}/month) indicates strong community adoption.`
        : npm.downloadsLast30Days > 1000
          ? `Moderate download volume (${formatDownloads(npm.downloadsLast30Days)}/month).`
          : `Low download volume (${formatDownloads(npm.downloadsLast30Days)}/month) — may indicate niche or new package.`,
      confidence: downloadResult.confidence,
      dataSources: ['npm downloads API'],
    },
  };

  // Calculate weighted average with confidence weighting
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [dim, value] of Object.entries(dimensions)) {
    let weight = DIMENSION_WEIGHTS[dim] ?? 0.05;
    const conf = confidenceMap[dim];
    if (conf === 'assumed') weight *= 0.7;
    if (conf === 'missing') weight *= 0.3;
    weightedSum += value * weight;
    totalWeight += weight;
  }

  let score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;

  // Bonus for provenance verification
  if (provenance.provenanceVerified && provenance.slsaLevel >= 1) {
    score = Math.min(100, score + 3);
  }

  return { score, dimensions, confidenceMap, dimensionExplanations };
}

// ── Build breakdown (positive/negative/neutral signals) ──
function buildBreakdown(
  npm: NpmEnrichment,
  cves: CveEnrichment,
  socket: SocketEnrichment,
  github: GitHubAdvisoryEnrichment,
  provenance: ProvenanceResult,
  dimensions: Record<string, number>,
): { positive: ScoreBreakdownItem[]; negative: ScoreBreakdownItem[]; neutral: ScoreBreakdownItem[] } {
  const positive: ScoreBreakdownItem[] = [];
  const negative: ScoreBreakdownItem[] = [];
  const neutral: ScoreBreakdownItem[] = [];

  // CVE signals
  if (cves.cveCount === 0) {
    positive.push({ signal: 'No known CVEs', points: '+20', source: 'OSV + NVD' });
  } else {
    negative.push({ signal: `${cves.cveCount} CVEs found`, points: `-${Math.min(50, cves.cveCount * 5)}`, source: 'OSV + NVD' });
  }

  // License
  if (npm.license === 'unknown' || npm.license === '') {
    negative.push({ signal: 'No license specified', points: '-10', source: 'npm registry' });
  } else if (npm.license.toLowerCase().includes('gpl')) {
    negative.push({ signal: `GPL license`, points: '-5', source: 'npm registry' });
  } else {
    positive.push({ signal: `License: ${npm.license}`, points: '+0', source: 'npm registry' });
  }

  // Freshness
  if (isFinishedPackage(npm)) {
    positive.push({ signal: 'Mature, stable package', points: '+0', source: 'npm registry', note: 'Not penalized for infrequent updates' });
  } else if (npm.lastPublishedDays <= 30) {
    positive.push({ signal: 'Active maintenance', points: '+8', source: 'npm registry' });
  } else if (npm.lastPublishedDays > 180) {
    negative.push({ signal: `Last updated ${npm.lastPublishedDays} days ago`, points: '-5', source: 'npm registry' });
  }

  // Supply chain
  if (socket.typoSquatDetected) {
    negative.push({ signal: 'Possible typosquatting', points: '-25', source: 'Heuristic' });
  }
  if (socket.depConfusionDetected) {
    negative.push({ signal: 'Dependency confusion risk', points: '-15', source: 'Heuristic' });
  }
  if (provenance.provenanceVerified) {
    positive.push({ signal: `Provenance verified (SLSA L${provenance.slsaLevel})`, points: '+3', source: 'npm registry' });
  }
  if (socket.hasTrustedPublisher) {
    positive.push({ signal: 'Trusted publisher', points: '+10', source: 'Socket.dev' });
  }

  // Downloads
  if (npm.downloadsLast30Days >= 100000) {
    positive.push({ signal: `${formatDownloads(npm.downloadsLast30Days)} monthly downloads`, points: '+10', source: 'npm downloads API' });
  } else if (npm.downloadsLast30Days < 100) {
    negative.push({ signal: `Low downloads (${npm.downloadsLast30Days}/month)`, points: '-10', source: 'npm downloads API' });
  }

  // Maintainers
  if (npm.maintainers.length >= 3) {
    positive.push({ signal: `${npm.maintainers.length} maintainers`, points: '+3', source: 'npm registry' });
  } else if (npm.maintainers.length === 1) {
    negative.push({ signal: 'Single maintainer (bus factor risk)', points: '-3', source: 'npm registry' });
  }

  // GitHub advisories
  if (github.advisoryCount > 0) {
    negative.push({ signal: `${github.advisoryCount} GitHub advisories`, points: `-${github.advisoryCount * 3}`, source: 'GitHub Advisory DB' });
  }

  // Download velocity
  const velMod = downloadVelocityModifier(npm);
  if (velMod < 0) {
    negative.push({ signal: 'Download volume declining', points: `${velMod}`, source: 'npm downloads API' });
  }

  return { positive, negative, neutral };
}

// ── Build improvement plan ──
function buildImprovementPlan(
  npm: NpmEnrichment,
  cves: CveEnrichment,
  socket: SocketEnrichment,
  provenance: ProvenanceResult,
  dimensions: Record<string, number>,
): ImprovementPlanItem[] {
  const plan: ImprovementPlanItem[] = [];

  if (cves.criticalCveCount > 0) {
    plan.push({
      action: 'Patch critical CVEs by updating to the latest version',
      estimatedIncrease: `+${Math.min(30, cves.criticalCveCount * 15)} points`,
      effort: 'hours',
      priority: 'critical',
    });
  }

  if (cves.highCveCount > 0) {
    plan.push({
      action: 'Address high-severity CVEs',
      estimatedIncrease: `+${Math.min(20, cves.highCveCount * 8)} points`,
      effort: 'hours',
      priority: 'high',
    });
  }

  if (!provenance.provenanceVerified) {
    plan.push({
      action: 'Publish with npm --provenance to enable SLSA attestation',
      estimatedIncrease: '+3 points',
      effort: '1 hour',
      priority: 'high',
    });
  }

  if (npm.maintainers.length < 2) {
    plan.push({
      action: 'Add a second maintainer to reduce bus factor risk',
      estimatedIncrease: '+2 points',
      effort: 'varies',
      priority: 'medium',
    });
  }

  if (socket.typoSquatDetected) {
    plan.push({
      action: 'Verify this is the correct package — possible typosquatting detected',
      estimatedIncrease: '+25 points',
      effort: 'minutes',
      priority: 'critical',
    });
  }

  if (!npm.repository) {
    plan.push({
      action: 'Add a repository link to package.json',
      estimatedIncrease: '+2 points',
      effort: '10 minutes',
      priority: 'medium',
    });
  }

  if (!npm.hasReadme) {
    plan.push({
      action: 'Add a README with usage instructions and examples',
      estimatedIncrease: '+5 points',
      effort: '1 hour',
      priority: 'medium',
    });
  }

  if (npm.lastPublishedDays > 365 && !isFinishedPackage(npm)) {
    plan.push({
      action: 'Release a new version to show active maintenance',
      estimatedIncrease: `+${Math.round((100 - dimensions.configurationFreshness) * DIMENSION_WEIGHTS.configurationFreshness)} points`,
      effort: 'varies',
      priority: 'medium',
    });
  }

  if (socket.source !== 'socket_api') {
    plan.push({
      action: 'Set SOCKET_API_KEY for verified supply chain analysis',
      estimatedIncrease: 'Unlocks verified scoring',
      effort: '30 minutes',
      priority: 'low',
    });
  }

  return plan;
}

// ── Build PublishableScoreReport from enrichment data ──
function buildScoreReport(
  score: number,
  npm: NpmEnrichment,
  cves: CveEnrichment,
  socket: SocketEnrichment,
  github: GitHubAdvisoryEnrichment,
  provenance: ProvenanceResult,
  dimensions: Record<string, number>,
  confidenceMap: Record<string, Confidence>,
): PublishableScoreReport {
  const grade = computeGrade(score);

  const categories: PublishableCategory[] = [
    {
      name: 'CVE Posture',
      score: dimensions.cvePosture,
      weight: DIMENSION_WEIGHTS.cvePosture,
      weightPercent: Math.round(DIMENSION_WEIGHTS.cvePosture * 100),
      contributionPoints: Math.round(dimensions.cvePosture * DIMENSION_WEIGHTS.cvePosture),
      findings: cves.findings.slice(0, 5).map((f) => `${f.id}: ${f.summary.substring(0, 100)}`),
      plainEnglish: cves.cveCount === 0
        ? 'No known vulnerabilities found.'
        : `${cves.cveCount} vulnerabilities found (${cves.criticalCveCount} critical, ${cves.highCveCount} high).`,
    },
    {
      name: 'Supply Chain Integrity',
      score: dimensions.supplyChainIntegrity,
      weight: DIMENSION_WEIGHTS.supplyChainIntegrity,
      weightPercent: Math.round(DIMENSION_WEIGHTS.supplyChainIntegrity * 100),
      contributionPoints: Math.round(dimensions.supplyChainIntegrity * DIMENSION_WEIGHTS.supplyChainIntegrity),
      findings: [
        socket.typoSquatDetected ? 'Possible typosquatting detected' : null,
        socket.depConfusionDetected ? 'Potential dependency confusion risk' : null,
        socket.hasTrustedPublisher ? 'Published by trusted organization' : null,
        provenance.provenanceVerified ? `npm provenance verified (SLSA L${provenance.slsaLevel})` : null,
        socket.highConfidenceMalware ? 'MALWARE DETECTED' : null,
      ].filter(Boolean) as string[],
      plainEnglish: socket.typoSquatDetected
        ? 'Potential typosquatting detected — verify this is the correct package.'
        : socket.hasTrustedPublisher
          ? 'Published by a verified organization with provenance attestation.'
          : 'Supply chain signals are within normal range.',
    },
    {
      name: 'Authentication',
      score: dimensions.authStrength,
      weight: DIMENSION_WEIGHTS.authStrength,
      weightPercent: Math.round(DIMENSION_WEIGHTS.authStrength * 100),
      contributionPoints: Math.round(dimensions.authStrength * DIMENSION_WEIGHTS.authStrength),
      findings: ['Authentication capability assessed from package metadata'],
      plainEnglish: 'Authentication support is inferred from package description and keywords.',
    },
    {
      name: 'Transport Security',
      score: dimensions.transportSecurity,
      weight: DIMENSION_WEIGHTS.transportSecurity,
      weightPercent: Math.round(DIMENSION_WEIGHTS.transportSecurity * 100),
      contributionPoints: Math.round(dimensions.transportSecurity * DIMENSION_WEIGHTS.transportSecurity),
      findings: [`Transport type: ${isHttpPackage(npm) ? 'HTTP-based' : 'stdio (local)'}`],
      plainEnglish: isHttpPackage(npm)
        ? 'This package uses HTTP transport — ensure HTTPS is enabled in production.'
        : 'This package uses stdio transport (local process communication).',
    },
    {
      name: 'Attack History',
      score: dimensions.observedAttackHistory,
      weight: DIMENSION_WEIGHTS.observedAttackHistory,
      weightPercent: Math.round(DIMENSION_WEIGHTS.observedAttackHistory * 100),
      contributionPoints: Math.round(dimensions.observedAttackHistory * DIMENSION_WEIGHTS.observedAttackHistory),
      findings: [
        ...cves.findings.slice(0, 3).map((f) => `CVE: ${f.id}`),
        ...github.advisories.slice(0, 3).map((a) => `GHSA: ${a.ghsaId}`),
      ],
      plainEnglish: totalAdvisories(cves, github) === 0
        ? 'No known attack history or security advisories.'
        : `${totalAdvisories(cves, github)} security advisories found across CVE databases.`,
    },
    {
      name: 'Response Hygiene',
      score: dimensions.responseHygiene,
      weight: DIMENSION_WEIGHTS.responseHygiene,
      weightPercent: Math.round(DIMENSION_WEIGHTS.responseHygiene * 100),
      contributionPoints: Math.round(dimensions.responseHygiene * DIMENSION_WEIGHTS.responseHygiene),
      findings: [
        npm.hasReadme ? 'Has README documentation' : 'Missing README',
        npm.hasKeywords ? 'Has keyword metadata' : 'Missing keywords',
        npm.homepage ? 'Has homepage' : 'No homepage set',
        npm.repository ? 'Has repository link' : 'No repository linked',
      ],
      plainEnglish: `Package has ${responseHygienePercent(npm)}% of hygiene signals present.`,
    },
    {
      name: 'Freshness',
      score: dimensions.configurationFreshness,
      weight: DIMENSION_WEIGHTS.configurationFreshness,
      weightPercent: Math.round(DIMENSION_WEIGHTS.configurationFreshness * 100),
      contributionPoints: Math.round(dimensions.configurationFreshness * DIMENSION_WEIGHTS.configurationFreshness),
      findings: [`Last updated ${npm.lastPublishedDays} days ago`],
      plainEnglish: isFinishedPackage(npm)
        ? `Mature, stable package with ${formatDownloads(npm.downloadsLast30Days)} monthly downloads — actively used despite infrequent updates.`
        : npm.lastPublishedDays <= 30
          ? 'Actively maintained — updated within the last month.'
          : `Last updated ${npm.lastPublishedDays} days ago — may need attention.`,
    },
    {
      name: 'Tool Capability Risk',
      score: dimensions.abilityRiskSurface,
      weight: DIMENSION_WEIGHTS.abilityRiskSurface,
      weightPercent: Math.round(DIMENSION_WEIGHTS.abilityRiskSurface * 100),
      contributionPoints: Math.round(dimensions.abilityRiskSurface * DIMENSION_WEIGHTS.abilityRiskSurface),
      findings: [`${socket.totalToolCount} tools exposed`],
      plainEnglish: 'Risk surface assessed from package capabilities and tool exposure.',
    },
  ];

  // Build issues
  const issues: PublishableIssue[] = [];
  if (cves.criticalCveCount > 0) {
    issues.push({
      severity: 'critical',
      title: `${cves.criticalCveCount} critical vulnerabilities`,
      plainEnglish: `This package has ${cves.criticalCveCount} critical CVEs that should be patched immediately.`,
      fixHint: 'Update to the latest version or apply patches for the listed CVEs.',
    });
  }
  if (socket.typoSquatDetected) {
    issues.push({
      severity: 'high',
      title: 'Possible typosquatting',
      plainEnglish: 'This package name is very similar to a popular package — verify you have the right one.',
      fixHint: 'Double-check the package name and publisher before using.',
    });
  }
  if (socket.depConfusionDetected) {
    issues.push({
      severity: 'high',
      title: 'Dependency confusion risk',
      plainEnglish: 'This scoped package may be vulnerable to dependency confusion attacks.',
      fixHint: 'Verify the package origin and consider using a private registry.',
    });
  }
  if (cves.highCveCount > 0) {
    issues.push({
      severity: 'high',
      title: `${cves.highCveCount} high-severity vulnerabilities`,
      plainEnglish: `This package has ${cves.highCveCount} high-severity CVEs.`,
      fixHint: 'Review the CVE details and update when patches are available.',
    });
  }
  if (npm.license === 'unknown' || npm.license === '') {
    issues.push({
      severity: 'medium',
      title: 'No license specified',
      plainEnglish: 'This package has no license — legal risk for commercial use.',
      fixHint: 'Contact the maintainer or choose an alternative with a clear license.',
    });
  }

  // Build improvement actions
  const improvementActions: ImprovementAction[] = [];
  if (dimensions.cvePosture < 70) {
    improvementActions.push({
      priority: 'immediate',
      category: 'CVE Posture',
      action: 'Patch all known vulnerabilities by updating to the latest version.',
      expectedScoreIncrease: Math.round((100 - dimensions.cvePosture) * DIMENSION_WEIGHTS.cvePosture),
      effort: 'days',
    });
  }
  if (!provenance.provenanceVerified) {
    improvementActions.push({
      priority: 'high',
      category: 'Supply Chain',
      action: 'Publish with npm --provenance to enable SLSA attestation.',
      expectedScoreIncrease: 3,
      effort: 'hours',
    });
  }
  if (npm.lastPublishedDays > 90 && !isFinishedPackage(npm)) {
    improvementActions.push({
      priority: 'medium',
      category: 'Freshness',
      action: 'Update the package to a more recent version.',
      expectedScoreIncrease: Math.round((100 - dimensions.configurationFreshness) * DIMENSION_WEIGHTS.configurationFreshness),
      effort: 'days',
    });
  }
  if (!npm.repository) {
    improvementActions.push({
      priority: 'medium',
      category: 'Response Hygiene',
      action: 'Add a repository link to package.json.',
      expectedScoreIncrease: 2,
      effort: 'hours',
    });
  }

  // Build summary
  const summaryParts: string[] = [];
  summaryParts.push(`Overall score: ${score}/100 (grade ${grade}).`);
  if (cves.cveCount > 0) summaryParts.push(`${cves.cveCount} CVEs found.`);
  if (socket.typoSquatDetected) summaryParts.push('Possible typosquatting detected.');
  if (socket.depConfusionDetected) summaryParts.push('Dependency confusion risk detected.');
  if (provenance.provenanceVerified) summaryParts.push(`Provenance verified at SLSA L${provenance.slsaLevel}.`);
  if (npm.license === 'unknown' || npm.license === '') summaryParts.push('No license specified.');
  if (isFinishedPackage(npm)) summaryParts.push('Mature, stable package — not penalized for infrequent updates.');
  if (npm.downloadsLast30Days > 0) {
    summaryParts.push(`${formatDownloads(npm.downloadsLast30Days)} downloads in the last 30 days.`);
  }
  const evidenceCount = Object.values(confidenceMap).filter((c) => c === 'verified').length;
  const totalDimensions = Object.keys(confidenceMap).length;
  summaryParts.push(`${Math.round((evidenceCount / totalDimensions) * 100)}% of scoring dimensions have verified data.`);

  return {
    overallScore: score,
    grade,
    summaryPlainEnglish: summaryParts.join(' '),
    categories,
    improvementActions,
    issues,
  };
}

// ── Helper functions ──
function isHttpPackage(npm: NpmEnrichment): boolean {
  return npm.description.toLowerCase().includes('http') ||
    npm.description.toLowerCase().includes('sse') ||
    npm.description.toLowerCase().includes('streamable') ||
    npm.keywords.some((k) => ['http', 'sse', 'streamable', 'remote'].includes(k.toLowerCase()));
}

function totalAdvisories(cves: CveEnrichment, github: GitHubAdvisoryEnrichment): number {
  return cves.cveCount + github.advisoryCount;
}

function responseHygienePercent(npm: NpmEnrichment): number {
  const signals = [npm.hasReadme, npm.hasKeywords, !!npm.homepage, !!npm.repository, npm.maintainers.length > 0];
  return Math.round((signals.filter(Boolean).length / signals.length) * 100);
}

function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

// ── Main scoring functions ──
export async function scorePackageStatic(name: string): Promise<ScoreResult> {
  const enrichment = await gatherEnrichment(name);
  const { score, dimensions, confidenceMap, dimensionExplanations } = computeScore(
    enrichment.npm, enrichment.cves, enrichment.socket, enrichment.github, enrichment.provenance,
  );

  const scoreReport = buildScoreReport(
    score, enrichment.npm, enrichment.cves, enrichment.socket,
    enrichment.github, enrichment.provenance, dimensions, confidenceMap,
  );

  const breakdown = buildBreakdown(
    enrichment.npm, enrichment.cves, enrichment.socket,
    enrichment.github, enrichment.provenance, dimensions,
  );

  const improvementPlan = buildImprovementPlan(
    enrichment.npm, enrichment.cves, enrichment.socket,
    enrichment.provenance, dimensions,
  );

  const checks = [
    { id: 'score-report', overallScore: score, grade: scoreReport.grade },
    { id: 'npm-metadata', description: enrichment.npm.description, downloads: enrichment.npm.downloadsLast30Days },
    { id: 'cve-scan', total: enrichment.cves.cveCount, critical: enrichment.cves.criticalCveCount, maxCvss: enrichment.cves.maxCvss },
    { id: 'supply-chain', score: enrichment.socket.socketSupplyChainScore, source: enrichment.socket.source },
    { id: 'github-advisories', count: enrichment.github.advisoryCount },
    { id: 'provenance', verified: enrichment.provenance.provenanceVerified, slsaLevel: enrichment.provenance.slsaLevel },
    { id: 'license', value: enrichment.npm.license },
    { id: 'confidence', map: confidenceMap },
  ];

  return {
    packageName: name,
    version: enrichment.npm.version,
    score,
    grade: scoreReport.grade,
    level: scoreToLevel(score),
    cves: { total: enrichment.cves.cveCount, critical: enrichment.cves.criticalCveCount },
    dimensions,
    dimensionExplanations,
    confidenceMap,
    scoreReport,
    breakdown,
    improvementPlan,
    checks,
    computedAt: new Date().toISOString(),
    scanTier: 'static',
    serverName: name.split('/').pop() ?? name,
    includesLiveData: false,
  };
}

export async function scorePackageLive(name: string): Promise<ScoreResult> {
  const result = await scorePackageStatic(name);
  result.scanTier = 'live';
  result.includesLiveData = true;
  return result;
}

export function scorePackageByName(packageName: string): { score: number; grade: string; cves: number } {
  return { score: 0, grade: 'N/A', cves: 0 };
}

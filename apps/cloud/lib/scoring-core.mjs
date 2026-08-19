/**
 * Scoring core v3 — single source of truth for mastyf.ai trust scoring.
 *
 * Used by BOTH the Next.js on-demand scorer (lib/package-scorer.ts) and the
 * batch worker (scripts/package-score-worker.mjs) so scores are identical
 * everywhere.
 *
 * v3 changes vs v2:
 *   • New behavioralIntegrity dimension (15%) driven by the live attack probe
 *     (tarball scan). Probe findings penalise by severity; when the probe
 *     cannot run the dimension scores 50 (neutral — no penalty applied).
 *   • Confidence re-weighting removed — it mathematically inflated scores
 *     toward the high-verified dimensions. Replaced with flat uncertainty
 *     penalties (−2 per assumed dimension, −5 per missing, capped −12).
 *   • "Absence of bad news" is capped: zero CVEs/advisories scores at most 85
 *     when multi-source verified, 70 otherwise.
 *   • Download trend/spike analysis from npm-stat.com time-series.
 *   • Stricter grade thresholds (A ≥ 80, B ≥ 70, C ≥ 55, D ≥ 35).
 *   • Reports carry full CVE/GHSA/probe findings so issues render with detail.
 */

import { behavioralScoreFromProbe } from './probe/attack-probe.mjs';

// ── Dimension weights (sum = 1.00) ─────────────────────────────────────────

export const DIMENSION_WEIGHTS = {
  cvePosture: 0.18,
  supplyChainIntegrity: 0.15,
  behavioralIntegrity: 0.15,
  observedAttackHistory: 0.10,
  configurationFreshness: 0.09,
  responseHygiene: 0.08,
  authStrength: 0.07,
  abilityRiskSurface: 0.07,
  transportSecurity: 0.05,
  licenseRisk: 0.03,
  downloadHealth: 0.03,
};

export const UNCERTAINTY_PENALTY_ASSUMED = 2;
export const UNCERTAINTY_PENALTY_MISSING = 5;
export const UNCERTAINTY_PENALTY_CAP = 12;
export const PROVENANCE_BONUS = 3;

// ── Grades & levels (stricter in v3) ────────────────────────────────────────

export function computeGrade(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

export function scoreToLevel(score) {
  if (score >= 90) return 'platinum';
  if (score >= 80) return 'gold';
  if (score >= 65) return 'silver';
  return 'bronze';
}

export function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function freshnessScore(daysSinceUpdate) {
  if (daysSinceUpdate <= 0) return 100;
  if (daysSinceUpdate <= 7) return 95;
  if (daysSinceUpdate <= 30) return 85;
  if (daysSinceUpdate <= 90) return 70;
  if (daysSinceUpdate <= 180) return 55;
  if (daysSinceUpdate <= 365) return 40;
  return Math.max(10, 30 - Math.log2(daysSinceUpdate / 365) * 10);
}

function isFinishedPackage(npm) {
  return npm.packageAgeDays > 365 && npm.lastPublishedDays > 180 && npm.downloadsLast30Days > 1000;
}

function finishedPackageFreshness(npm) {
  const downloadsPerDay = npm.downloadsLast30Days / 30;
  if (downloadsPerDay > 1000) return 85;
  if (downloadsPerDay > 100) return 75;
  if (downloadsPerDay > 10) return 65;
  return 50;
}

function downloadPopularityModifier(downloads30d) {
  if (downloads30d >= 1000000) return 15;
  if (downloads30d >= 100000) return 10;
  if (downloads30d >= 10000) return 5;
  if (downloads30d >= 1000) return 0;
  if (downloads30d >= 100) return -5;
  if (downloads30d >= 10) return -10;
  return -15;
}

function downloadVelocityModifier(npm) {
  if (npm.downloadsLast30Days === 0) return -10;
  const ratio = npm.downloadsLast7Days / (npm.downloadsLast30Days / 4);
  if (ratio > 2.0) return -10;
  if (ratio > 1.5) return -5;
  if (ratio < 0.2) return -10;
  if (ratio < 0.5) return -5;
  return 0;
}

function formatDownloads(count) {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

function isHttpPackage(npm) {
  const desc = (npm.description || '').toLowerCase();
  const kw = (npm.keywords || []).map((k) => String(k).toLowerCase());
  return desc.includes('http') || desc.includes('sse') || desc.includes('streamable') ||
    kw.some((k) => ['http', 'sse', 'streamable', 'remote'].includes(k));
}

function totalAdvisories(cves, github) {
  return (cves?.cveCount ?? 0) + (github?.advisoryCount ?? 0);
}

function responseHygienePercent(npm) {
  const signals = [npm.hasReadme, npm.hasKeywords, !!npm.homepage, !!npm.repository, npm.maintainers.length > 0];
  return Math.round((signals.filter(Boolean).length / signals.length) * 100);
}

// ── Dimension computations ──────────────────────────────────────────────────

function computeCvePosture(cves) {
  if (!cves || cves.status === 'unavailable') return { score: 50, confidence: 'missing' };

  let score = 100;
  if (cves.maxCvss > 0) score -= cves.maxCvss * 8;
  score -= cves.criticalCveCount * 12;
  score -= cves.highCveCount * 6;
  score -= cves.mediumCveCount * 2;
  score -= cves.lowCveCount * 0.5;

  if (cves.newestCveAgeDays > 0 && score < 100) {
    const recency = cves.newestCveAgeDays < 30 ? 1.5
      : cves.newestCveAgeDays < 90 ? 1.2
      : cves.newestCveAgeDays < 365 ? 1.0
      : 0.7;
    score = 100 - (100 - score) * recency;
  }

  const patchedCount = (cves.findings || []).filter((f) => f.fixedVersion).length;
  if ((cves.findings || []).length > 0) {
    const patchRatio = patchedCount / cves.findings.length;
    if (patchRatio === 1.0) score += 5;
    else if (patchRatio > 0.5) score += 2;
  }

  // v3: absence of bad news is capped. Verified-clean (query succeeded, zero
  // findings) caps at 85; unverified-clean caps at 70.
  if (cves.cveCount === 0) {
    const verifiedClean = cves.status === 'ok';
    score = Math.min(score, verifiedClean ? 85 : 70);
  }

  const confidence = cves.status === 'ok' ? 'verified' : 'assumed';
  return { score: clamp(Math.round(score)), confidence };
}

function computeSupplyChain(socket, provenance) {
  if (!socket) return { score: 50, confidence: 'missing' };
  let score = socket.socketSupplyChainScore;
  if (socket.typoSquatDetected) score -= 25;
  if (socket.depConfusionDetected) score -= 15;
  if (provenance?.provenanceVerified) score += 10;
  if (socket.hasTrustedPublisher) score += 10;
  if (socket.highConfidenceMalware) score -= 50;
  if (socket.malwareSignalCount > 0) score -= socket.malwareSignalCount * 5;
  const confidence = socket.source === 'socket_api' ? 'verified' : 'assumed';
  return { score: clamp(Math.round(score)), confidence };
}

function computeBehavioralIntegrity(probe) {
  const score = behavioralScoreFromProbe(probe);
  const confidence = probe?.status === 'ok' ? 'verified' : 'assumed';
  return { score, confidence };
}

function computeAuthStrength(npm, socket) {
  const kw = (npm.keywords || []).map((k) => String(k).toLowerCase());
  const hasAuth = (npm.description || '').toLowerCase().includes('auth') ||
    kw.some((k) => ['auth', 'oauth', 'jwt', 'api-key'].includes(k));
  let score = 40;
  if (hasAuth) score += 20;
  if (socket?.source === 'socket_api') {
    score = socket.socketSupplyChainScore > 70 ? 70 : 40;
    return { score, confidence: 'verified' };
  }
  return { score, confidence: 'assumed' };
}

function computeTransportSecurity(npm) {
  const kw = (npm.keywords || []).map((k) => String(k).toLowerCase());
  const isStdio = kw.some((k) => ['stdio', 'local', 'cli'].includes(k));
  let score = 50;
  if (isStdio) score = 80;
  if (isHttpPackage(npm)) score = 40;
  return { score, confidence: 'assumed' };
}

function computeAttackHistory(cves, github) {
  const advisories = totalAdvisories(cves, github);
  const critical = (cves?.criticalCveCount ?? 0) + (github?.criticalAdvisoryCount ?? 0);

  let score = 100;
  score -= advisories * 8;
  score -= critical * 15;

  const ages = [cves?.newestCveAgeDays, github?.newestAdvisoryAgeDays].filter((a) => typeof a === 'number' && a > 0);
  const newestAge = ages.length ? Math.min(...ages) : Infinity;
  if (newestAge < 30) score -= 10;
  else if (newestAge < 90) score -= 5;

  // v3: verified-clean cap, same as CVE posture
  if (advisories === 0) {
    const verifiedClean = cves?.status === 'ok' || github?.status === 'ok';
    score = Math.min(score, verifiedClean ? 85 : 70);
  }

  const confidence = (cves?.status === 'ok' || github?.status === 'ok') ? 'verified' : 'assumed';
  return { score: clamp(Math.round(score)), confidence };
}

function computeResponseHygiene(npm) {
  const signals = [
    npm.hasReadme ? 1 : 0,
    npm.hasKeywords ? 1 : 0,
    npm.homepage ? 1 : 0,
    npm.repository ? 1 : 0,
    npm.maintainers.length > 0 ? 1 : 0,
    npm.maintainers.length >= 3 ? 1 : 0,
  ];
  const score = Math.round((signals.reduce((a, b) => a + b, 0) / signals.length) * 100);
  return { score, confidence: 'verified' };
}

function computeFreshness(npm) {
  if (isFinishedPackage(npm)) {
    return { score: finishedPackageFreshness(npm), confidence: 'verified' };
  }
  return { score: freshnessScore(npm.lastPublishedDays), confidence: 'verified' };
}

function computeToolRiskSurface(socket, npm) {
  if (socket?.source === 'socket_api' && socket.totalToolCount > 0) {
    const highRatio = socket.highRiskToolCount / socket.totalToolCount;
    const mediumRatio = socket.mediumRiskToolCount / socket.totalToolCount;
    const riskScore = highRatio * 0 + mediumRatio * 30 + (1 - highRatio - mediumRatio) * 80;
    return { score: clamp(Math.round(riskScore)), confidence: 'verified' };
  }
  let score = 50;
  if (npm.dependencyCount > 50) score -= 15;
  if (npm.dependencyCount > 100) score -= 10;
  if (npm.dependencyCount <= 5) score += 15;
  if (npm.repository) score += 10;
  if (socket?.hasTrustedPublisher) score += 10;
  return { score: clamp(score), confidence: 'assumed' };
}

function licenseRiskScore(license) {
  const l = (license || '').toLowerCase().trim();
  if (l === 'unknown' || l === '' || l === 'unlicensed') return { score: 20, confidence: 'verified' };
  if (l.includes('gpl') || l.includes('agpl')) return { score: 40, confidence: 'verified' };
  if (l.includes('lgpl') || l.includes('mpl')) return { score: 60, confidence: 'verified' };
  if (l.includes('mit') || l.includes('apache') || l.includes('bsd') || l.includes('isc') || l.includes('0bsd')) return { score: 90, confidence: 'verified' };
  if (l.includes('artistic') || l.includes('zlib') || l.includes('unlicense')) return { score: 85, confidence: 'verified' };
  return { score: 70, confidence: 'verified' };
}

function computeDownloadHealth(npm, trend) {
  let score = 50;
  score += downloadPopularityModifier(npm.downloadsLast30Days);
  score += downloadVelocityModifier(npm);

  // v3: npm-stat.com time-series signals
  if (trend?.available) {
    if (trend.spikeDetected) score -= 15; // suspicious download inflation
    if (trend.collapseDetected) score -= 10; // sudden abandonment signal
  }

  return { score: clamp(score), confidence: 'verified' };
}

// ── Core scoring ────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {object} input.npm npm enrichment
 * @param {object} input.cves CVE enrichment
 * @param {object} input.socket Socket enrichment
 * @param {object} input.github GitHub advisory enrichment
 * @param {object} input.provenance provenance result
 * @param {object|null} input.probe probe result (null = never attempted)
 * @param {object|null} input.trend npm-stat trend (optional)
 */
export function computeScoreV3({ npm, cves, socket, github, provenance, probe, trend }) {
  const cveResult = computeCvePosture(cves);
  const supplyResult = computeSupplyChain(socket, provenance);
  const behavioralResult = computeBehavioralIntegrity(probe);
  const authResult = computeAuthStrength(npm, socket);
  const transportResult = computeTransportSecurity(npm);
  const attackResult = computeAttackHistory(cves, github);
  const hygieneResult = computeResponseHygiene(npm);
  const freshnessResult = computeFreshness(npm);
  const riskResult = computeToolRiskSurface(socket, npm);
  const licenseResult = licenseRiskScore(npm.license);
  const downloadResult = computeDownloadHealth(npm, trend);

  const dimensions = {
    cvePosture: cveResult.score,
    supplyChainIntegrity: supplyResult.score,
    behavioralIntegrity: behavioralResult.score,
    authStrength: authResult.score,
    transportSecurity: transportResult.score,
    observedAttackHistory: attackResult.score,
    responseHygiene: hygieneResult.score,
    configurationFreshness: freshnessResult.score,
    abilityRiskSurface: riskResult.score,
    licenseRisk: licenseResult.score,
    downloadHealth: downloadResult.score,
  };

  const confidenceMap = {
    cvePosture: cveResult.confidence,
    supplyChainIntegrity: supplyResult.confidence,
    behavioralIntegrity: behavioralResult.confidence,
    authStrength: authResult.confidence,
    transportSecurity: transportResult.confidence,
    observedAttackHistory: attackResult.confidence,
    responseHygiene: hygieneResult.confidence,
    configurationFreshness: freshnessResult.confidence,
    abilityRiskSurface: riskResult.confidence,
    licenseRisk: licenseResult.confidence,
    downloadHealth: downloadResult.confidence,
  };

  // v3: plain weighted average — NO confidence re-weighting (it inflated scores)
  let weightedSum = 0;
  for (const [dim, value] of Object.entries(dimensions)) {
    weightedSum += value * (DIMENSION_WEIGHTS[dim] ?? 0);
  }
  let score = Math.round(weightedSum);

  // Provenance bonus
  if (provenance?.provenanceVerified && provenance.slsaLevel >= 1) {
    score += PROVENANCE_BONUS;
  }

  // v3: flat uncertainty penalties replace confidence re-weighting
  let uncertaintyPenalty = 0;
  for (const conf of Object.values(confidenceMap)) {
    if (conf === 'assumed') uncertaintyPenalty += UNCERTAINTY_PENALTY_ASSUMED;
    else if (conf === 'missing') uncertaintyPenalty += UNCERTAINTY_PENALTY_MISSING;
  }
  uncertaintyPenalty = Math.min(uncertaintyPenalty, UNCERTAINTY_PENALTY_CAP);

  score = clamp(score - uncertaintyPenalty);

  const dimensionExplanations = buildDimensionExplanations({
    npm, cves, socket, github, provenance, probe, trend,
    dimensions, confidenceMap,
  });

  return {
    score,
    dimensions,
    confidenceMap,
    dimensionExplanations,
    uncertaintyPenalty,
  };
}

function buildDimensionExplanations({ npm, cves, socket, github, provenance, probe, trend, dimensions, confidenceMap }) {
  const probeFindings = probe?.findings ?? [];
  return {
    cvePosture: {
      score: dimensions.cvePosture,
      explanation: cves.cveCount === 0
        ? (cves.status === 'ok'
          ? 'No vulnerabilities found across OSV, NVD and GitHub Advisory databases (verified clean).'
          : 'No vulnerabilities found, but one or more CVE sources were unavailable.')
        : `${cves.cveCount} vulnerabilities found (${cves.criticalCveCount} critical, ${cves.highCveCount} high). Max CVSS: ${cves.maxCvss}.`,
      confidence: confidenceMap.cvePosture,
      dataSources: ['OSV.dev', 'NVD', 'GitHub Advisory DB'],
    },
    supplyChainIntegrity: {
      score: dimensions.supplyChainIntegrity,
      explanation: socket.typoSquatDetected
        ? 'Possible typosquatting detected — verify this is the correct package.'
        : socket.depConfusionDetected
          ? 'Potential dependency confusion risk detected.'
          : socket.highConfidenceMalware
            ? 'Malware signals detected — do not use this package.'
            : socket.hasTrustedPublisher
              ? 'Published by a known trusted organization.'
              : 'Supply chain signals are within normal range.',
      confidence: confidenceMap.supplyChainIntegrity,
      dataSources: socket.source === 'socket_api' ? ['Socket.dev API'] : ['Heuristic analysis'],
      improvement: socket.source !== 'socket_api' ? 'Set SOCKET_API_KEY for verified supply chain analysis' : undefined,
    },
    behavioralIntegrity: {
      score: dimensions.behavioralIntegrity,
      explanation: probe?.status === 'ok'
        ? (probeFindings.length === 0
          ? `Live attack probe scanned ${probe.filesScanned} published files — no secret leaks, dangerous execution patterns or suspicious egress found.`
          : `Live attack probe scanned ${probe.filesScanned} published files and found ${probeFindings.length} issue(s): ${probe.counts.critical} critical, ${probe.counts.high} high, ${probe.counts.medium} medium, ${probe.counts.low} low.`)
        : `Live attack probe could not run (${probe?.reason ?? 'not attempted'}) — score penalised for the missing behavioural signal.`,
      confidence: confidenceMap.behavioralIntegrity,
      dataSources: ['npm tarball probe'],
    },
    authStrength: {
      score: dimensions.authStrength,
      explanation: 'Authentication support assessed from package metadata and description.',
      confidence: confidenceMap.authStrength,
      dataSources: ['npm registry metadata'],
    },
    transportSecurity: {
      score: dimensions.transportSecurity,
      explanation: isHttpPackage(npm)
        ? 'This package uses HTTP transport — ensure HTTPS is enabled in production.'
        : 'This package uses stdio transport (local process communication).',
      confidence: confidenceMap.transportSecurity,
      dataSources: ['npm registry metadata'],
    },
    observedAttackHistory: {
      score: dimensions.observedAttackHistory,
      explanation: totalAdvisories(cves, github) === 0
        ? 'No known attack history or security advisories.'
        : `${totalAdvisories(cves, github)} security advisories found across CVE databases.`,
      confidence: confidenceMap.observedAttackHistory,
      dataSources: ['OSV.dev', 'NVD', 'GitHub Advisory DB'],
    },
    responseHygiene: {
      score: dimensions.responseHygiene,
      explanation: `Package has ${responseHygienePercent(npm)}% of hygiene signals present (README, keywords, homepage, repo, maintainers).`,
      confidence: confidenceMap.responseHygiene,
      dataSources: ['npm registry metadata'],
    },
    configurationFreshness: {
      score: dimensions.configurationFreshness,
      explanation: isFinishedPackage(npm)
        ? `Mature package (${npm.packageAgeDays} days old) with stable downloads — not penalized for infrequent updates.`
        : npm.lastPublishedDays <= 30
          ? 'Actively maintained — updated within the last month.'
          : npm.lastPublishedDays <= 90
            ? 'Updated within the last quarter.'
            : `Last updated ${npm.lastPublishedDays} days ago — may need attention.`,
      confidence: confidenceMap.configurationFreshness,
      dataSources: ['npm registry metadata'],
    },
    abilityRiskSurface: {
      score: dimensions.abilityRiskSurface,
      explanation: `Risk surface assessed from ${npm.dependencyCount} dependencies and tool capabilities.`,
      confidence: confidenceMap.abilityRiskSurface,
      dataSources: confidenceMap.abilityRiskSurface === 'verified' ? ['Socket.dev API'] : ['Heuristic analysis'],
    },
    licenseRisk: {
      score: dimensions.licenseRisk,
      explanation: npm.license === 'unknown' || npm.license === ''
        ? 'No license specified — legal risk for commercial use.'
        : npm.license.toLowerCase().includes('gpl')
          ? 'GPL license detected — copyleft risk for commercial use.'
          : `License: ${npm.license} — permissive, no legal risk.`,
      confidence: confidenceMap.licenseRisk,
      dataSources: ['npm registry metadata'],
    },
    downloadHealth: {
      score: dimensions.downloadHealth,
      explanation: trend?.available && trend.spikeDetected
        ? `Download spike detected (last week ${trend.trendRatio}× the baseline) — possible artificial inflation.`
        : trend?.available && trend.collapseDetected
          ? `Downloads collapsed to ${Math.round(trend.trendRatio * 100)}% of baseline — possible abandonment.`
          : npm.downloadsLast30Days > 100000
            ? `High download volume (${formatDownloads(npm.downloadsLast30Days)}/month) indicates strong community adoption.`
            : npm.downloadsLast30Days > 1000
              ? `Moderate download volume (${formatDownloads(npm.downloadsLast30Days)}/month).`
              : `Low download volume (${formatDownloads(npm.downloadsLast30Days)}/month) — may indicate niche or new package.`,
      confidence: confidenceMap.downloadHealth,
      dataSources: trend?.available ? ['npm downloads API', 'npm-stat.com'] : ['npm downloads API'],
    },
  };
}

// ── Report builder ──────────────────────────────────────────────────────────

function category(name, dimScore, findings, plainEnglish) {
  const weight = DIMENSION_WEIGHTS[dimKeyFor(name)] ?? 0;
  return {
    name,
    score: dimScore,
    weight,
    weightPercent: Math.round(weight * 100),
    contributionPoints: Math.round(dimScore * weight),
    findings: findings.filter(Boolean).slice(0, 8),
    plainEnglish,
  };
}

function dimKeyFor(categoryName) {
  const map = {
    'CVE Posture': 'cvePosture',
    'Supply Chain Integrity': 'supplyChainIntegrity',
    'Behavioral Integrity': 'behavioralIntegrity',
    'Attack History': 'observedAttackHistory',
    'Freshness': 'configurationFreshness',
    'Response Hygiene': 'responseHygiene',
    'Authentication': 'authStrength',
    'Tool Capability Risk': 'abilityRiskSurface',
    'Transport Security': 'transportSecurity',
    'License Risk': 'licenseRisk',
    'Download Health': 'downloadHealth',
  };
  return map[categoryName] ?? '';
}

/**
 * Build the publishable score report with FULL findings/issues detail.
 */
export function buildScoreReportV3({ score, npm, cves, socket, github, provenance, probe, trend, dimensions }) {
  const grade = computeGrade(score);
  const probeFindings = probe?.findings ?? [];

  const categories = [
    category('CVE Posture', dimensions.cvePosture,
      (cves.findings || []).slice(0, 6).map((f) =>
        `${f.id} (${f.severity}${f.fixedVersion ? `, fixed in ${f.fixedVersion}` : ', no fix yet'}): ${f.summary.substring(0, 120)}`),
      cves.cveCount === 0
        ? 'No known vulnerabilities found.'
        : `${cves.cveCount} vulnerabilities found (${cves.criticalCveCount} critical, ${cves.highCveCount} high).`),

    category('Supply Chain Integrity', dimensions.supplyChainIntegrity, [
      socket.typoSquatDetected ? 'Possible typosquatting detected' : null,
      socket.depConfusionDetected ? 'Potential dependency confusion risk' : null,
      socket.hasTrustedPublisher ? 'Published by trusted organization' : null,
      provenance?.provenanceVerified ? `npm provenance verified (SLSA L${provenance.slsaLevel})` : 'No npm provenance attestation',
      socket.highConfidenceMalware ? 'MALWARE DETECTED' : null,
      socket.source === 'socket_api' ? `Socket.dev supply chain score: ${socket.socketSupplyChainScore}/100` : 'Socket.dev API not used (heuristic only)',
    ], socket.typoSquatDetected
      ? 'Potential typosquatting detected — verify this is the correct package.'
      : socket.highConfidenceMalware
        ? 'Malware signals detected — avoid this package.'
        : socket.hasTrustedPublisher
          ? 'Published by a verified organization.'
          : 'Supply chain signals are within normal range.'),

    category('Behavioral Integrity', dimensions.behavioralIntegrity,
      probe?.status === 'ok'
        ? (probeFindings.length === 0
          ? [`Probe scanned ${probe.filesScanned} published files — clean`]
          : probeFindings.slice(0, 8).map((f) => `${f.severity.toUpperCase()}: ${f.title} (${f.file}${f.line ? `:${f.line}` : ''})`))
        : [`Probe could not run: ${probe?.reason ?? 'not attempted'}`],
      probe?.status === 'ok'
        ? (probeFindings.length === 0
          ? 'Live attack probe found no secret leaks, dangerous execution or suspicious egress in the published code.'
          : `Live attack probe found ${probeFindings.length} issue(s) in the published code.`)
        : 'The live attack probe could not run, so behavioural integrity is unverified and penalised.'),

    category('Attack History', dimensions.observedAttackHistory, [
      ...(cves.findings || []).slice(0, 4).map((f) => `CVE: ${f.id} (${f.severity})`),
      ...(github.advisories || []).slice(0, 4).map((a) => `GHSA: ${a.ghsaId}${a.cveId ? ` / ${a.cveId}` : ''} (${a.severity})`),
    ], totalAdvisories(cves, github) === 0
      ? 'No known attack history or security advisories.'
      : `${totalAdvisories(cves, github)} security advisories found across CVE databases.`),

    category('Freshness', dimensions.configurationFreshness,
      [`Last updated ${npm.lastPublishedDays} days ago`, `Package age: ${npm.packageAgeDays} days`],
      isFinishedPackage(npm)
        ? `Mature, stable package with ${formatDownloads(npm.downloadsLast30Days)} monthly downloads — actively used despite infrequent updates.`
        : npm.lastPublishedDays <= 30
          ? 'Actively maintained — updated within the last month.'
          : `Last updated ${npm.lastPublishedDays} days ago — may need attention.`),

    category('Response Hygiene', dimensions.responseHygiene, [
      npm.hasReadme ? 'Has README documentation' : 'Missing README',
      npm.hasKeywords ? 'Has keyword metadata' : 'Missing keywords',
      npm.homepage ? 'Has homepage' : 'No homepage set',
      npm.repository ? 'Has repository link' : 'No repository linked',
      `${npm.maintainers.length} maintainer(s)`,
    ], `Package has ${responseHygienePercent(npm)}% of hygiene signals present.`),

    category('Authentication', dimensions.authStrength,
      ['Authentication capability assessed from package metadata'],
      'Authentication support is inferred from package description and keywords.'),

    category('Tool Capability Risk', dimensions.abilityRiskSurface,
      [`${npm.dependencyCount} direct dependencies`, socket.totalToolCount > 0 ? `${socket.totalToolCount} tools exposed` : null],
      'Risk surface assessed from package capabilities, dependencies and tool exposure.'),

    category('Transport Security', dimensions.transportSecurity,
      [`Transport type: ${isHttpPackage(npm) ? 'HTTP-based' : 'stdio (local)'}`],
      isHttpPackage(npm)
        ? 'This package uses HTTP transport — ensure HTTPS is enabled in production.'
        : 'This package uses stdio transport (local process communication).'),

    category('License Risk', dimensions.licenseRisk,
      [`License: ${npm.license}`],
      npm.license === 'unknown' || npm.license === ''
        ? 'No license specified — legal risk for commercial use.'
        : `License: ${npm.license}.`),

    category('Download Health', dimensions.downloadHealth, [
      `${formatDownloads(npm.downloadsLast30Days)} downloads in the last 30 days`,
      trend?.available ? `7-day trend: ${trend.trendRatio}× baseline (npm-stat.com)` : null,
      trend?.spikeDetected ? 'Download spike detected' : null,
      trend?.collapseDetected ? 'Download collapse detected' : null,
    ], trend?.available && trend.spikeDetected
      ? 'Downloads spiked far above baseline — possible artificial inflation.'
      : `${formatDownloads(npm.downloadsLast30Days)} monthly downloads.`),
  ];

  // ── Issues (full detail: CVEs, GHSAs, probe findings, supply chain) ──
  const issues = [];

  // Per-critical-CVE issues with IDs
  for (const f of (cves.findings || []).filter((x) => x.severity === 'CRITICAL').slice(0, 5)) {
    issues.push({
      severity: 'critical',
      title: `Critical vulnerability ${f.id}`,
      plainEnglish: f.summary.substring(0, 200) || `Critical CVE ${f.id} affects this package.`,
      fixHint: f.fixedVersion ? `Update to version ${f.fixedVersion} or later.` : 'No fixed version available yet — consider an alternative or apply mitigations.',
    });
  }
  for (const f of (cves.findings || []).filter((x) => x.severity === 'HIGH').slice(0, 5)) {
    issues.push({
      severity: 'high',
      title: `High-severity vulnerability ${f.id}`,
      plainEnglish: f.summary.substring(0, 200) || `High-severity CVE ${f.id} affects this package.`,
      fixHint: f.fixedVersion ? `Update to version ${f.fixedVersion} or later.` : 'Watch for a patched release.',
    });
  }
  if (cves.mediumCveCount > 0) {
    issues.push({
      severity: 'medium',
      title: `${cves.mediumCveCount} medium-severity vulnerabilities`,
      plainEnglish: `This package has ${cves.mediumCveCount} medium-severity CVEs.`,
      fixHint: 'Review the CVE details and update when patches are available.',
    });
  }

  // GHSA details
  for (const a of (github.advisories || []).filter((x) => x.severity === 'CRITICAL' || x.severity === 'HIGH').slice(0, 5)) {
    issues.push({
      severity: a.severity === 'CRITICAL' ? 'critical' : 'high',
      title: `GitHub advisory ${a.ghsaId}${a.cveId ? ` (${a.cveId})` : ''}`,
      plainEnglish: a.summary.substring(0, 200) || `GitHub advisory ${a.ghsaId} affects this package.`,
      fixHint: a.fixedVersion ? `Update to version ${a.fixedVersion} or later.` : 'Watch for a patched release.',
    });
  }

  // Probe findings as issues
  for (const f of probeFindings.slice(0, 10)) {
    issues.push({
      severity: f.severity,
      title: f.title,
      plainEnglish: f.plainEnglish,
      fixHint: f.category === 'secret-leak'
        ? 'The maintainer must rotate the exposed credential immediately and remove it from the published code.'
        : f.category === 'install-script'
          ? 'Review what the install hook executes before installing this package.'
          : 'Review the flagged file before using this package in production.',
    });
  }
  if (!probe || probe.status !== 'ok') {
    issues.push({
      severity: 'medium',
      title: 'Live attack probe could not run',
      plainEnglish: `The behavioural probe could not scan this package's published code (${probe?.reason ?? 'not attempted'}). Behavioural integrity is unverified and the score is penalised.`,
      fixHint: 'Re-run the scan later; if the package tarball is unavailable the package may have been unpublished.',
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
  if (socket.highConfidenceMalware) {
    issues.push({
      severity: 'critical',
      title: 'Malware signals detected',
      plainEnglish: 'Supply-chain analysis flagged this package as likely malware.',
      fixHint: 'Do not install. Report the package to npm security.',
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
  if (trend?.spikeDetected) {
    issues.push({
      severity: 'medium',
      title: 'Suspicious download spike',
      plainEnglish: `Downloads in the last week are ${trend.trendRatio}× the preceding baseline — possible artificial inflation.`,
      fixHint: 'Treat popularity signals for this package with caution.',
    });
  }
  if (npm.lastPublishedDays > 365 && !isFinishedPackage(npm)) {
    issues.push({
      severity: 'medium',
      title: 'Package appears unmaintained',
      plainEnglish: `No release in ${npm.lastPublishedDays} days and download volume does not indicate a stable finished package.`,
      fixHint: 'Check for forks or maintained alternatives.',
    });
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => (severityRank[a.severity] ?? 4) - (severityRank[b.severity] ?? 4));

  // ── Improvement actions ──
  const improvementActions = [];
  if (dimensions.cvePosture < 70) {
    improvementActions.push({
      priority: 'immediate', category: 'CVE Posture',
      action: 'Patch all known vulnerabilities by updating to the latest version.',
      expectedScoreIncrease: Math.round((100 - dimensions.cvePosture) * DIMENSION_WEIGHTS.cvePosture),
      effort: 'days',
    });
  }
  if (probeFindings.some((f) => f.category === 'secret-leak')) {
    improvementActions.push({
      priority: 'immediate', category: 'Behavioral Integrity',
      action: 'Rotate exposed credentials and remove hardcoded secrets from the published code.',
      expectedScoreIncrease: Math.round((100 - dimensions.behavioralIntegrity) * DIMENSION_WEIGHTS.behavioralIntegrity),
      effort: 'hours',
    });
  }
  if (!provenance?.provenanceVerified) {
    improvementActions.push({
      priority: 'high', category: 'Supply Chain',
      action: 'Publish with npm --provenance to enable SLSA attestation.',
      expectedScoreIncrease: PROVENANCE_BONUS, effort: 'hours',
    });
  }
  if (npm.lastPublishedDays > 90 && !isFinishedPackage(npm)) {
    improvementActions.push({
      priority: 'medium', category: 'Freshness',
      action: 'Update the package to a more recent version.',
      expectedScoreIncrease: Math.round((100 - dimensions.configurationFreshness) * DIMENSION_WEIGHTS.configurationFreshness),
      effort: 'days',
    });
  }
  if (!npm.repository) {
    improvementActions.push({
      priority: 'medium', category: 'Response Hygiene',
      action: 'Add a repository link to package.json.',
      expectedScoreIncrease: 2, effort: '10 minutes',
    });
  }

  // ── Summary ──
  const summaryParts = [];
  summaryParts.push(`Overall score: ${score}/100 (grade ${grade}).`);
  if (cves.cveCount > 0) summaryParts.push(`${cves.cveCount} CVEs found (${cves.criticalCveCount} critical).`);
  if (github.advisoryCount > 0) summaryParts.push(`${github.advisoryCount} GitHub advisories.`);
  if (probe?.status === 'ok' && probeFindings.length > 0) {
    summaryParts.push(`Live probe found ${probeFindings.length} code issue(s) (${probe.counts.critical} critical, ${probe.counts.high} high).`);
  } else if (probe?.status === 'ok') {
    summaryParts.push('Live attack probe found no malicious patterns in the published code.');
  } else {
    summaryParts.push('Live attack probe could not run — behavioural integrity unverified.');
  }
  if (socket.typoSquatDetected) summaryParts.push('Possible typosquatting detected.');
  if (provenance?.provenanceVerified) summaryParts.push(`Provenance verified at SLSA L${provenance.slsaLevel}.`);
  if (npm.license === 'unknown' || npm.license === '') summaryParts.push('No license specified.');
  if (npm.downloadsLast30Days > 0) summaryParts.push(`${formatDownloads(npm.downloadsLast30Days)} downloads in the last 30 days.`);

  return {
    overallScore: score,
    grade,
    summaryPlainEnglish: summaryParts.join(' '),
    categories,
    improvementActions,
    issues,
  };
}

// ── Checks builder (shape consumed by directory + detail pages) ─────────────

export function buildChecksV3({ score, grade, npm, cves, socket, github, provenance, probe, trend, confidenceMap }) {
  const checks = [
    { id: 'score-report', overallScore: score, grade },
    {
      id: 'npm-metadata',
      description: npm.description,
      downloads: npm.downloadsLast30Days,
      downloads7d: npm.downloadsLast7Days,
      license: npm.license,
      packageAgeDays: npm.packageAgeDays,
      lastPublishedDays: npm.lastPublishedDays,
      maintainerCount: npm.maintainers.length,
      version: npm.version,
      homepage: npm.homepage,
      repository: npm.repository,
      dependencyCount: npm.dependencyCount,
    },
    {
      id: 'cve-scan',
      total: cves.cveCount,
      critical: cves.criticalCveCount,
      high: cves.highCveCount,
      medium: cves.mediumCveCount,
      low: cves.lowCveCount,
      maxCvss: cves.maxCvss,
      status: cves.status,
    },
    {
      id: 'cve-findings',
      findings: (cves.findings || []).slice(0, 20).map((f) => ({
        id: f.id, severity: f.severity, summary: f.summary.substring(0, 220),
        fixedVersion: f.fixedVersion ?? null, source: f.source,
      })),
    },
    {
      id: 'ghsa-findings',
      findings: (github.advisories || []).slice(0, 20).map((a) => ({
        ghsaId: a.ghsaId, cveId: a.cveId ?? null, severity: a.severity,
        summary: (a.summary || '').substring(0, 220), publishedAt: a.publishedAt,
        fixedVersion: a.fixedVersion ?? null,
      })),
    },
    { id: 'github-advisories', count: github.advisoryCount },
    {
      id: 'supply-chain',
      score: socket.socketSupplyChainScore,
      source: socket.source,
      typoSquatDetected: socket.typoSquatDetected,
      depConfusionDetected: socket.depConfusionDetected,
      malwareSignalCount: socket.malwareSignalCount,
      highConfidenceMalware: socket.highConfidenceMalware,
      hasTrustedPublisher: socket.hasTrustedPublisher,
      highAlertCount: socket.socketHighAlertCount,
    },
    {
      id: 'behavioral-probe',
      status: probe?.status ?? 'unable',
      reason: probe?.reason ?? null,
      score: behavioralScoreFromProbe(probe),
      filesScanned: probe?.filesScanned ?? 0,
      durationMs: probe?.durationMs ?? 0,
      counts: probe?.counts ?? { critical: 0, high: 0, medium: 0, low: 0 },
      findings: (probe?.findings ?? []).slice(0, 20).map((f) => ({
        id: f.id, category: f.category, severity: f.severity, title: f.title,
        file: f.file, line: f.line, evidence: f.evidence, plainEnglish: f.plainEnglish,
      })),
    },
    {
      id: 'download-stats',
      total30d: trend?.available ? trend.total30d : npm.downloadsLast30Days,
      last7dAvg: trend?.last7dAvg ?? 0,
      prev23dAvg: trend?.prev23dAvg ?? 0,
      trendRatio: trend?.trendRatio ?? 1,
      spikeDetected: trend?.spikeDetected ?? false,
      collapseDetected: trend?.collapseDetected ?? false,
      source: trend?.available ? 'npm-stat' : 'npm-api',
    },
    { id: 'provenance', verified: provenance?.provenanceVerified ?? false, slsaLevel: provenance?.slsaLevel ?? 0 },
    { id: 'license', value: npm.license },
    { id: 'confidence', map: confidenceMap },
  ];
  return checks;
}

// ── Breakdown (positive / negative / neutral signals) ───────────────────────

export function buildBreakdownV3({ npm, cves, socket, github, provenance, probe, trend, dimensions }) {
  const positive = [];
  const negative = [];
  const neutral = [];

  if (cves.cveCount === 0) positive.push({ signal: 'No known CVEs', points: '+0', source: 'OSV + NVD' });
  else negative.push({ signal: `${cves.cveCount} CVEs found`, points: `-${Math.min(50, cves.cveCount * 5)}`, source: 'OSV + NVD' });

  if (probe?.status === 'ok' && probe.findings.length === 0) {
    positive.push({ signal: `Live probe clean (${probe.filesScanned} files scanned)`, points: '+0', source: 'npm tarball probe' });
  } else if (probe?.status === 'ok') {
    negative.push({ signal: `Live probe: ${probe.findings.length} finding(s) (${probe.counts.critical} critical)`, points: `-${Math.min(60, probe.findings.length * 10)}`, source: 'npm tarball probe' });
  } else {
    neutral.push({ signal: 'Live probe did not run', points: '+0', source: 'npm tarball probe' });
  }

  if (npm.license === 'unknown' || npm.license === '') negative.push({ signal: 'No license specified', points: '-10', source: 'npm registry' });
  else if (npm.license.toLowerCase().includes('gpl')) negative.push({ signal: 'GPL license', points: '-5', source: 'npm registry' });
  else positive.push({ signal: `License: ${npm.license}`, points: '+0', source: 'npm registry' });

  if (isFinishedPackage(npm)) positive.push({ signal: 'Mature, stable package', points: '+0', source: 'npm registry', note: 'Not penalized for infrequent updates' });
  else if (npm.lastPublishedDays <= 30) positive.push({ signal: 'Active maintenance', points: '+8', source: 'npm registry' });
  else if (npm.lastPublishedDays > 180) negative.push({ signal: `Last updated ${npm.lastPublishedDays} days ago`, points: '-5', source: 'npm registry' });

  if (socket.typoSquatDetected) negative.push({ signal: 'Possible typosquatting', points: '-25', source: 'Heuristic' });
  if (socket.depConfusionDetected) negative.push({ signal: 'Dependency confusion risk', points: '-15', source: 'Heuristic' });
  if (provenance?.provenanceVerified) positive.push({ signal: `Provenance verified (SLSA L${provenance.slsaLevel})`, points: `+${PROVENANCE_BONUS}`, source: 'npm registry' });
  if (socket.hasTrustedPublisher) positive.push({ signal: 'Trusted publisher', points: '+10', source: 'Socket.dev' });

  if (npm.downloadsLast30Days >= 100000) positive.push({ signal: `${formatDownloads(npm.downloadsLast30Days)} monthly downloads`, points: '+10', source: 'npm downloads API' });
  else if (npm.downloadsLast30Days < 100) negative.push({ signal: `Low downloads (${npm.downloadsLast30Days}/month)`, points: '-10', source: 'npm downloads API' });

  if (trend?.spikeDetected) negative.push({ signal: `Download spike (${trend.trendRatio}× baseline)`, points: '-15', source: 'npm-stat.com' });
  if (trend?.collapseDetected) negative.push({ signal: 'Download collapse', points: '-10', source: 'npm-stat.com' });

  if (npm.maintainers.length >= 3) positive.push({ signal: `${npm.maintainers.length} maintainers`, points: '+3', source: 'npm registry' });
  else if (npm.maintainers.length === 1) negative.push({ signal: 'Single maintainer (bus factor risk)', points: '-3', source: 'npm registry' });

  if (github.advisoryCount > 0) negative.push({ signal: `${github.advisoryCount} GitHub advisories`, points: `-${github.advisoryCount * 3}`, source: 'GitHub Advisory DB' });

  const velMod = downloadVelocityModifier(npm);
  if (velMod < 0) negative.push({ signal: 'Download volume declining', points: `${velMod}`, source: 'npm downloads API' });

  return { positive, negative, neutral };
}

// ── Improvement plan (legacy shape kept for API compatibility) ──────────────

export function buildImprovementPlanV3({ npm, cves, socket, provenance, probe, dimensions }) {
  const plan = [];

  if (cves.criticalCveCount > 0) {
    plan.push({ action: 'Patch critical CVEs by updating to the latest version', estimatedIncrease: `+${Math.min(30, cves.criticalCveCount * 15)} points`, effort: 'hours', priority: 'critical' });
  }
  if ((probe?.findings ?? []).some((f) => f.category === 'secret-leak')) {
    plan.push({ action: 'Rotate and remove hardcoded credentials found by the live probe', estimatedIncrease: '+20 points', effort: 'hours', priority: 'critical' });
  }
  if (cves.highCveCount > 0) {
    plan.push({ action: 'Address high-severity CVEs', estimatedIncrease: `+${Math.min(20, cves.highCveCount * 8)} points`, effort: 'hours', priority: 'high' });
  }
  if (!provenance?.provenanceVerified) {
    plan.push({ action: 'Publish with npm --provenance to enable SLSA attestation', estimatedIncrease: `+${PROVENANCE_BONUS} points`, effort: '1 hour', priority: 'high' });
  }
  if (npm.maintainers.length < 2) {
    plan.push({ action: 'Add a second maintainer to reduce bus factor risk', estimatedIncrease: '+2 points', effort: 'varies', priority: 'medium' });
  }
  if (socket.typoSquatDetected) {
    plan.push({ action: 'Verify this is the correct package — possible typosquatting detected', estimatedIncrease: '+25 points', effort: 'minutes', priority: 'critical' });
  }
  if (!npm.repository) {
    plan.push({ action: 'Add a repository link to package.json', estimatedIncrease: '+2 points', effort: '10 minutes', priority: 'medium' });
  }
  if (!npm.hasReadme) {
    plan.push({ action: 'Add a README with usage instructions and examples', estimatedIncrease: '+5 points', effort: '1 hour', priority: 'medium' });
  }
  if (npm.lastPublishedDays > 365 && !isFinishedPackage(npm)) {
    plan.push({ action: 'Release a new version to show active maintenance', estimatedIncrease: `+${Math.round((100 - dimensions.configurationFreshness) * DIMENSION_WEIGHTS.configurationFreshness)} points`, effort: 'varies', priority: 'medium' });
  }
  return plan;
}

/**
 * Explainability engine — generates plain-English score breakdowns,
 * improvement plans, and risk category labels.
 */

import type { ScoreResult, Confidence, DimensionExplanation, ScoreBreakdownItem, ImprovementPlanItem } from './package-scorer';

export type RiskCategory = 'enterprise_ready' | 'production_safe' | 'use_with_caution' | 'experimental' | 'abandoned' | 'critical_risk';

export type RiskLabel = {
  category: RiskCategory;
  label: string;
  color: 'green' | 'yellow' | 'orange' | 'red';
  description: string;
};

export type ExplainabilityReport = {
  packageName: string;
  score: number;
  grade: string;
  riskLabel: RiskLabel;
  breakdown: {
    positive: ScoreBreakdownItem[];
    negative: ScoreBreakdownItem[];
    neutral: ScoreBreakdownItem[];
  };
  dimensionExplanations: Record<string, DimensionExplanation>;
  confidenceSummary: {
    verified: number;
    assumed: number;
    missing: number;
    totalDimensions: number;
    verifiedPercent: number;
  };
  improvementPlan: ImprovementPlanItem[];
  topStrengths: string[];
  topWeaknesses: string[];
  plainEnglishSummary: string;
};

// ── Risk category determination ──
function determineRiskCategory(result: ScoreResult): RiskLabel {
  const { score, cves, dimensions, confidenceMap } = result;
  const verifiedCount = Object.values(confidenceMap).filter((c) => c === 'verified').length;
  const totalDims = Object.keys(confidenceMap).length;
  const verifiedPercent = (verifiedCount / totalDims) * 100;

  // Critical risk: critical CVEs or malware
  if (cves.critical > 0) {
    return {
      category: 'critical_risk',
      label: 'Critical Risk',
      color: 'red',
      description: `${cves.critical} critical CVE${cves.critical > 1 ? 's' : ''} requires immediate attention.`,
    };
  }

  // Abandoned: very old, low downloads, no maintenance
  if (dimensions.configurationFreshness < 30 && dimensions.downloadHealth < 30) {
    return {
      category: 'abandoned',
      label: 'Abandoned',
      color: 'red',
      description: 'This package appears abandoned — no recent activity and declining usage.',
    };
  }

  // Enterprise ready: high score, high verification, good supply chain
  if (score >= 85 && verifiedPercent > 60 && dimensions.supplyChainIntegrity > 70) {
    return {
      category: 'enterprise_ready',
      label: 'Enterprise Ready',
      color: 'green',
      description: 'High score with verified data across most dimensions. Supply chain integrity confirmed.',
    };
  }

  // Production safe: good score, decent verification
  if (score >= 70 && verifiedPercent > 40) {
    return {
      category: 'production_safe',
      label: 'Production Safe',
      color: 'green',
      description: 'Good score with sufficient data. Suitable for production use.',
    };
  }

  // Use with caution: moderate score or low verification
  if (score >= 50) {
    return {
      category: 'use_with_caution',
      label: 'Use With Caution',
      color: 'yellow',
      description: 'Moderate score — review the details before using in production.',
    };
  }

  // Experimental: low score
  return {
    category: 'experimental',
    label: 'Not Recommended',
    color: 'orange',
    description: 'Low score with significant concerns. Use only after thorough review.',
  };
}

// ── Extract top strengths and weaknesses ──
function extractTopItems(
  breakdown: { positive: ScoreBreakdownItem[]; negative: ScoreBreakdownItem[] },
  maxItems = 3,
): { strengths: string[]; weaknesses: string[] } {
  const strengths = breakdown.positive.slice(0, maxItems).map((item) => item.signal);
  const weaknesses = breakdown.negative.slice(0, maxItems).map((item) => item.signal);
  return { strengths, weaknesses };
}

// ── Build confidence summary ──
function buildConfidenceSummary(confidenceMap: Record<string, Confidence>): {
  verified: number;
  assumed: number;
  missing: number;
  totalDimensions: number;
  verifiedPercent: number;
} {
  const values = Object.values(confidenceMap);
  const verified = values.filter((c) => c === 'verified').length;
  const assumed = values.filter((c) => c === 'assumed').length;
  const missing = values.filter((c) => c === 'missing').length;
  const total = values.length;
  return {
    verified,
    assumed,
    missing,
    totalDimensions: total,
    verifiedPercent: Math.round((verified / total) * 100),
  };
}

// ── Build plain English summary ──
function buildPlainEnglishSummary(result: ScoreResult, riskLabel: RiskLabel): string {
  const parts: string[] = [];

  parts.push(`${result.packageName} scores ${result.score}/100 (${result.grade}).`);
  parts.push(`Risk assessment: ${riskLabel.label}.`);

  if (result.cves.total > 0) {
    parts.push(`${result.cves.total} known vulnerabilities (${result.cves.critical} critical).`);
  } else {
    parts.push('No known vulnerabilities.');
  }

  if (result.breakdown.positive.length > 0) {
    parts.push(`Key strengths: ${result.breakdown.positive.slice(0, 2).map((p) => p.signal.toLowerCase()).join(', ')}.`);
  }

  if (result.breakdown.negative.length > 0) {
    parts.push(`Areas for improvement: ${result.breakdown.negative.slice(0, 2).map((n) => n.signal.toLowerCase()).join(', ')}.`);
  }

  const confSummary = buildConfidenceSummary(result.confidenceMap);
  parts.push(`${confSummary.verifiedPercent}% of scoring data is verified from real sources.`);

  return parts.join(' ');
}

// ── Main function: generate explainability report ──
export function generateExplainabilityReport(result: ScoreResult): ExplainabilityReport {
  const riskLabel = determineRiskCategory(result);
  const confidenceSummary = buildConfidenceSummary(result.confidenceMap);
  const { strengths, weaknesses } = extractTopItems(result.breakdown);
  const plainEnglishSummary = buildPlainEnglishSummary(result, riskLabel);

  return {
    packageName: result.packageName,
    score: result.score,
    grade: result.grade,
    riskLabel,
    breakdown: result.breakdown,
    dimensionExplanations: result.dimensionExplanations,
    confidenceSummary,
    improvementPlan: result.improvementPlan,
    topStrengths: strengths,
    topWeaknesses: weaknesses,
    plainEnglishSummary,
  };
}

// ── Utility: format confidence badge ──
export function formatConfidenceBadge(confidence: Confidence): string {
  switch (confidence) {
    case 'verified': return '✅ Verified';
    case 'assumed': return '⚠️ Estimated';
    case 'missing': return '❌ No data';
  }
}

// ── Utility: format risk badge ──
export function formatRiskBadge(label: RiskLabel): string {
  const emoji = label.color === 'green' ? '🟢' : label.color === 'yellow' ? '🟡' : label.color === 'orange' ? '🟠' : '🔴';
  return `${emoji} ${label.label}`;
}

// ── Utility: format dimension with confidence ──
export function formatDimensionWithConfidence(
  name: string,
  score: number,
  confidence: Confidence,
): string {
  const badge = formatConfidenceBadge(confidence);
  return `${name}: ${score}/100 ${badge}`;
}

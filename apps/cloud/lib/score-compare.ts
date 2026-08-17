/**
 * Score comparison engine — provides side-by-side package comparison
 * with dimension breakdowns and winner analysis.
 */

import { scorePackageStatic, type ScoreResult } from './package-scorer';
import type { Confidence } from './package-scorer';

export type ComparisonResult = {
  packages: ComparisonPackage[];
  winner: {
    overall: string;
    byDimension: Record<string, string>;
  };
  summary: string;
};

export type ComparisonPackage = {
  name: string;
  score: number;
  grade: string;
  level: string;
  dimensions: Record<string, number>;
  confidenceMap: Record<string, Confidence>;
  strengths: string[];
  weaknesses: string[];
};

// ── Compare multiple packages ──
export async function comparePackageScores(
  packageNames: string[],
): Promise<ComparisonResult> {
  if (packageNames.length < 2) {
    throw new Error('Need at least 2 packages to compare');
  }

  // Score all packages
  const results = await Promise.all(
    packageNames.map((name) => scorePackageStatic(name)),
  );

  // Build comparison packages
  const packages: ComparisonPackage[] = results.map((result) => ({
    name: result.packageName,
    score: result.score,
    grade: result.grade,
    level: result.level,
    dimensions: result.dimensions,
    confidenceMap: result.confidenceMap,
    strengths: result.breakdown.positive.slice(0, 3).map((p) => p.signal),
    weaknesses: result.breakdown.negative.slice(0, 3).map((n) => n.signal),
  }));

  // Determine overall winner
  const sorted = [...packages].sort((a, b) => b.score - a.score);
  const overallWinner = sorted[0].name;

  // Determine winner per dimension
  const dimensionNames = Object.keys(packages[0].dimensions);
  const byDimension: Record<string, string> = {};
  for (const dim of dimensionNames) {
    const dimWinner = [...packages].sort(
      (a, b) => (b.dimensions[dim] ?? 0) - (a.dimensions[dim] ?? 0),
    )[0];
    byDimension[dim] = dimWinner.name;
  }

  // Build summary
  const summaryParts: string[] = [];
  summaryParts.push(`${overallWinner} leads overall with ${sorted[0].score}/100 (${sorted[0].grade}).`);

  // Count dimension wins
  const winCounts: Record<string, number> = {};
  for (const winner of Object.values(byDimension)) {
    winCounts[winner] = (winCounts[winner] ?? 0) + 1;
  }
  const dimensionLeader = Object.entries(winCounts).sort((a, b) => b[1] - a[1])[0];
  summaryParts.push(`${dimensionLeader[0]} leads in ${dimensionLeader[1]} of ${dimensionNames.length} dimensions.`);

  // Score range
  const scores = packages.map((p) => p.score);
  const range = Math.max(...scores) - Math.min(...scores);
  if (range < 10) {
    summaryParts.push('Scores are very close — choose based on specific dimension strengths.');
  } else if (range < 30) {
    summaryParts.push('Moderate difference — review specific trade-offs.');
  } else {
    summaryParts.push('Significant difference — the leading package is notably stronger.');
  }

  return {
    packages,
    winner: {
      overall: overallWinner,
      byDimension,
    },
    summary: summaryParts.join(' '),
  };
}

// ── Format comparison for display ──
export function formatComparisonTable(comparison: ComparisonResult): string {
  const header = ['Dimension', ...comparison.packages.map((p) => p.name)].join(' | ');
  const separator = ['---', ...comparison.packages.map(() => '---')].join(' | ');

  const rows = Object.keys(comparison.packages[0].dimensions).map((dim) => {
    const values = comparison.packages.map((p) => {
      const score = p.dimensions[dim] ?? 0;
      const winner = comparison.winner.byDimension[dim] === p.name;
      return winner ? `**${score}**` : String(score);
    });
    return [dim, ...values].join(' | ');
  });

  return [header, separator, ...rows].join('\n');
}

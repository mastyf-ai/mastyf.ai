export class NpmPackageNotFoundError extends Error {
  constructor(name: string) { super(`Package not found: ${name}`); }
}

export function isValidNpmPackageName(name: string): boolean {
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name);
}

import type { PackageScoreTier } from './package-score-resolver';
import type { PublishableScoreReport } from './score-report';

type ScoreResult = {
  packageName: string; version: string; score: number; grade: string; level: string;
  cves: { total: number; critical: number }; dimensions: Record<string, number>;
  scoreReport: PublishableScoreReport; checks: Record<string, unknown>[];
  computedAt: string; scanTier: PackageScoreTier; serverName: string; includesLiveData: boolean;
};

function stub(name: string): ScoreResult {
  return {
    packageName: name, version: 'latest', score: 50, grade: 'B', level: 'silver',
    cves: { total: 0, critical: 0 }, dimensions: {},
    scoreReport: { overallScore: 50, grade: 'B', summaryPlainEnglish: 'No issues found', categories: [], improvementActions: [], issues: [] },
    checks: [{ id: 'score-report', overallScore: 50, grade: 'B' }],
    computedAt: new Date().toISOString(), scanTier: 'static' as PackageScoreTier, serverName: name,
    includesLiveData: false,
  };
}

export async function scorePackageStatic(name: string): Promise<ScoreResult> { return stub(name); }
export async function scorePackageLive(name: string): Promise<ScoreResult> { return stub(name); }
export function scorePackageByName(packageName: string): { score: number; grade: string; cves: number } {
  return { score: 0, grade: 'N/A', cves: 0 };
}

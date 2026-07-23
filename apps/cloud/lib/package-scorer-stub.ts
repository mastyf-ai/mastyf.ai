export function scorePackageByName(packageName: string): { score: number; grade: string; cves: number } {
  return { score: 0, grade: 'N/A', cves: 0 };
}

export type PackageScoreResult = {
  score: number;
  grade: string;
  cveCount: number;
  dimensions: Record<string, number>;
};

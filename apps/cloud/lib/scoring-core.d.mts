import type { ProbeResult } from './probe/attack-probe.mjs';
import type { NpmStatTrend } from './enrichers/npm-stat-enricher.mjs';
import type { PublishableScoreReport } from './score-report';

export type ConfidenceV3 = 'verified' | 'assumed' | 'missing';

export type DimensionExplanationV3 = {
  score: number;
  explanation: string;
  confidence: ConfidenceV3;
  dataSources: string[];
  improvement?: string;
};

export type NpmEnrichmentInput = {
  packageName: string;
  version: string;
  description: string;
  homepage: string;
  repository: string;
  license: string;
  maintainers: string[];
  downloadsLast30Days: number;
  downloadsLast7Days: number;
  packageAgeDays: number;
  lastPublishedDays: number;
  dependencyCount: number;
  hasReadme: boolean;
  hasKeywords: boolean;
  keywords: string[];
};

export type CveEnrichmentInput = {
  packageName: string;
  cveCount: number;
  criticalCveCount: number;
  highCveCount: number;
  mediumCveCount: number;
  lowCveCount: number;
  maxCvss: number;
  newestCveAgeDays: number;
  vulnerableDependencyCount: number;
  findings: Array<{
    id: string;
    severity: string;
    summary: string;
    fixedVersion?: string | null;
    source: string;
  }>;
  status: 'ok' | 'degraded' | 'unavailable';
};

export type SocketEnrichmentInput = {
  packageName: string;
  socketSupplyChainScore: number;
  socketHighAlertCount: number;
  socketFeedAvailable: boolean;
  typoSquatDetected: boolean;
  depConfusionDetected: boolean;
  highConfidenceMalware: boolean;
  malwareSignalCount: number;
  hasTrustedPublisher: boolean;
  provenanceVerified: boolean;
  totalToolCount: number;
  highRiskToolCount: number;
  mediumRiskToolCount: number;
  source: 'socket_api' | 'heuristic' | 'unavailable';
};

export type GitHubAdvisoryInput = {
  packageName: string;
  advisoryCount: number;
  criticalAdvisoryCount: number;
  highAdvisoryCount: number;
  newestAdvisoryAgeDays: number;
  advisories: Array<{
    ghsaId: string;
    cveId: string | null;
    severity: string;
    summary: string;
    publishedAt: string;
    updatedAt?: string;
    withdrawnAt?: string | null;
    fixedVersion: string | null;
    ecosystem?: string;
  }>;
  status: 'ok' | 'degraded' | 'unavailable';
};

export type ProvenanceInput = {
  packageName: string;
  version: string;
  provenanceVerified: boolean;
  provenanceAvailable: boolean;
  slsaLevel: number;
  source: 'npm_registry' | 'unavailable';
};

export type ScoreInputV3 = {
  npm: NpmEnrichmentInput;
  cves: CveEnrichmentInput;
  socket: SocketEnrichmentInput;
  github: GitHubAdvisoryInput;
  provenance: ProvenanceInput;
  probe: ProbeResult | null;
  trend?: NpmStatTrend | null;
};

export type ScoreOutputV3 = {
  score: number;
  dimensions: Record<string, number>;
  confidenceMap: Record<string, ConfidenceV3>;
  dimensionExplanations: Record<string, DimensionExplanationV3>;
  uncertaintyPenalty: number;
};

export type BreakdownItemV3 = {
  signal: string;
  points: string;
  source: string;
  note?: string;
};

export type BreakdownV3 = {
  positive: BreakdownItemV3[];
  negative: BreakdownItemV3[];
  neutral: BreakdownItemV3[];
};

export type ImprovementPlanItemV3 = {
  action: string;
  estimatedIncrease: string;
  effort: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
};

export const DIMENSION_WEIGHTS: Record<string, number>;
export const UNCERTAINTY_PENALTY_ASSUMED: number;
export const UNCERTAINTY_PENALTY_MISSING: number;
export const UNCERTAINTY_PENALTY_CAP: number;
export const PROVENANCE_BONUS: number;

export function computeGrade(score: number): string;
export function scoreToLevel(score: number): string;
export function clamp(value: number, min?: number, max?: number): number;

export function computeScoreV3(input: ScoreInputV3): ScoreOutputV3;

export function buildScoreReportV3(input: {
  score: number;
  npm: NpmEnrichmentInput;
  cves: CveEnrichmentInput;
  socket: SocketEnrichmentInput;
  github: GitHubAdvisoryInput;
  provenance: ProvenanceInput;
  probe: ProbeResult | null;
  trend?: NpmStatTrend | null;
  dimensions: Record<string, number>;
}): PublishableScoreReport;

export function buildChecksV3(input: {
  score: number;
  grade: string;
  npm: NpmEnrichmentInput;
  cves: CveEnrichmentInput;
  socket: SocketEnrichmentInput;
  github: GitHubAdvisoryInput;
  provenance: ProvenanceInput;
  probe: ProbeResult | null;
  trend?: NpmStatTrend | null;
  confidenceMap: Record<string, ConfidenceV3>;
}): Record<string, unknown>[];

export function buildBreakdownV3(input: {
  npm: NpmEnrichmentInput;
  cves: CveEnrichmentInput;
  socket: SocketEnrichmentInput;
  github: GitHubAdvisoryInput;
  provenance: ProvenanceInput;
  probe: ProbeResult | null;
  trend?: NpmStatTrend | null;
  dimensions: Record<string, number>;
}): BreakdownV3;

export function buildImprovementPlanV3(input: {
  npm: NpmEnrichmentInput;
  cves: CveEnrichmentInput;
  socket: SocketEnrichmentInput;
  provenance: ProvenanceInput;
  probe: ProbeResult | null;
  dimensions: Record<string, number>;
}): ImprovementPlanItemV3[];

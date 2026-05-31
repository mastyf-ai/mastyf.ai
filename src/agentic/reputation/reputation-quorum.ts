/**
 * B1 — Byzantine quorum for decentralized reputation consensus.
 */
import type { ReputationDimensions } from './reputation-network.js';

export interface ReputationQuorumConfig {
  minDistinctRaters: number;
  minWeightedVotes: number;
}

export interface RaterVote {
  raterId: string;
  dimensions: Partial<ReputationDimensions>;
  raterWeight: number;
}

export function reputationQuorumConfig(): ReputationQuorumConfig {
  return {
    minDistinctRaters: Number(process.env.GUARDIAN_REPUTATION_MIN_RATERS ?? 2),
    minWeightedVotes: Number(process.env.GUARDIAN_REPUTATION_MIN_WEIGHT ?? 3),
  };
}

const DIMENSION_KEYS: Array<keyof ReputationDimensions> = [
  'security_posture',
  'auth_strength',
  'cve_hygiene',
  'publisher_trust',
  'policy_compliance',
  'uptime',
  'community_rating',
  'guardian_protected',
];

function median(values: number[]): number {
  if (!values.length) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Weighted median merge resilient to outlier raters (Byzantine-friendly). */
export function mergeRatingsWithQuorum(votes: RaterVote[]): {
  quorumMet: boolean;
  distinctRaters: number;
  weightedVotes: number;
  dimensions: ReputationDimensions | null;
  consensusScore: number;
} {
  const cfg = reputationQuorumConfig();
  const distinctRaters = new Set(votes.map(v => v.raterId)).size;
  const weightedVotes = votes.reduce((s, v) => s + Math.max(0.1, v.raterWeight), 0);
  const quorumMet = distinctRaters >= cfg.minDistinctRaters && weightedVotes >= cfg.minWeightedVotes;

  if (!votes.length) {
    return { quorumMet: false, distinctRaters: 0, weightedVotes: 0, dimensions: null, consensusScore: 0 };
  }

  const merged = {} as ReputationDimensions;
  for (const key of DIMENSION_KEYS) {
    const weighted: number[] = [];
    for (const v of votes) {
      const val = v.dimensions[key];
      if (val == null) continue;
      const reps = Math.max(1, Math.round(v.raterWeight));
      for (let i = 0; i < reps; i++) weighted.push(val);
    }
    merged[key] = Math.round(median(weighted.length ? weighted : [50]));
  }

  const values = Object.values(merged);
  const consensusScore = Math.round(values.reduce((a, b) => a + b, 0) / values.length);

  return {
    quorumMet,
    distinctRaters,
    weightedVotes,
    dimensions: quorumMet ? merged : null,
    consensusScore: quorumMet ? consensusScore : Math.round(consensusScore * 0.85),
  };
}

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
export declare function reputationQuorumConfig(): ReputationQuorumConfig;
/** Weighted median merge resilient to outlier raters (Byzantine-friendly). */
export declare function mergeRatingsWithQuorum(votes: RaterVote[]): {
    quorumMet: boolean;
    distinctRaters: number;
    weightedVotes: number;
    dimensions: ReputationDimensions | null;
    consensusScore: number;
};
//# sourceMappingURL=reputation-quorum.d.ts.map
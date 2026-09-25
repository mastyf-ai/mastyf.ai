/**
 * Active Learning Calibrator — uncertainty-ranked semantic review queue + threshold recommendations.
 */
import type { StoredSemanticAudit } from './semantic-audit-store.js';
import { type FingerprintLabels } from './learning-quorum.js';
export type UncertaintyRankedRecord = StoredSemanticAudit & {
    uncertaintyScore: number;
    uncertaintyReasons: string[];
};
export type ThresholdRecommendation = {
    currentMinConfidence: number;
    currentLocalThreshold: number;
    recommendedMinConfidence: number;
    recommendedLocalThreshold: number;
    rationale: string;
    labeledCount: number;
    falsePositiveRate: number;
    quorumMet: boolean;
    quorumRequired: boolean;
};
export declare function rankSemanticReviewQueue(records: StoredSemanticAudit[], opts?: {
    limit?: number;
    excludeSeeded?: boolean;
}): UncertaintyRankedRecord[];
export declare function recommendSemanticThresholds(records: StoredSemanticAudit[], quorumLabels?: Record<string, FingerprintLabels>): ThresholdRecommendation;
export declare function buildActiveLearningReport(records: StoredSemanticAudit[]): {
    reviewQueue: UncertaintyRankedRecord[];
    thresholds: ThresholdRecommendation;
    totals: {
        records: number;
        flagged: number;
        unlabeled: number;
    };
};
//# sourceMappingURL=semantic-active-learning.d.ts.map
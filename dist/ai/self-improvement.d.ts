import type { DriftReport, DriftState } from './drift-detector.js';
import { type FingerprintLabels } from './learning-quorum.js';
export { resolveAiLearningStatePath } from './ai-paths.js';
export interface LearningOutcome {
    suggestionId: string;
    ruleName: string;
    source: 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern' | 'attack';
    action: 'applied' | 'rejected' | 'modified' | 'ignored';
    confidence: number;
    timestamp: string;
    userFeedback?: string;
    userId?: string;
    fingerprint?: string;
    pattern?: string;
    quorumApplied?: boolean;
}
export interface LearningState {
    outcomes: LearningOutcome[];
    falsePositiveRate: number;
    truePositiveRate: number;
    adaptiveThreshold: number;
    moduleWeights: Record<string, number>;
    lastUpdated: string;
    learningInitialized?: boolean;
    lastCycleAt?: string;
    cyclesCompleted?: number;
    recordsAnalyzed?: number;
    baselinesLearned?: number;
    suggestionsGenerated?: number;
    /** Per-fingerprint label events for quorum anti-poisoning */
    labelFingerprints?: Record<string, FingerprintLabels>;
    drift?: DriftState;
    /** Rolling accept precision on labeled outcomes (proxy for model quality) */
    precisionProxy?: number;
    lastPrecisionProxy?: number;
}
/**
 * Self-Improvement Engine — reinforcement learning loop that tracks
 * which suggestions are accepted/rejected and adjusts: confidence scoring,
 * auto-apply thresholds, and module trust weights.
 */
export declare class SelfImprovement {
    private state;
    private statePath;
    private sharedStore;
    constructor(statePath?: string, sharedStore?: any);
    setSharedStore(store: any): void;
    private loadSharedState;
    private loadState;
    recordCycleComplete(summary: {
        recordsAnalyzed: number;
        baselinesLearned: number;
        suggestionsGenerated: number;
    }): void;
    private saveState;
    /** Record drift report; freezes threshold tuning until MASTYF_AI_AI_DRIFT_OVERRIDE=true. */
    recordDriftReport(report: DriftReport): void;
    getDriftState(): DriftState | undefined;
    isThresholdAdjustmentFrozen(): boolean;
    /**
     * Record a suggestion outcome. Label events are always stored; weight/threshold
     * changes apply only after quorum (≥2 distinct labelers OR ≥10 weighted labels).
     */
    recordOutcome(outcome: LearningOutcome, opts?: {
        userId?: string;
        pattern?: string;
        skipQuorum?: boolean;
    }): {
        quorumApplied: boolean;
    };
    private trimOutcomes;
    private computePrecisionProxy;
    private checkPrecisionRollback;
    private recomputeRates;
    /** Manual rollback to previous learning snapshot. */
    rollback(): {
        ok: boolean;
        snapshotId?: string;
        reason?: string;
    };
    adjustConfidence(rawConfidence: number, source: string): number;
    getAdaptiveThreshold(): number;
    suggestPruning(): string[];
    getState(): Readonly<LearningState>;
    getQuorumConfig(): import("./learning-quorum.js").QuorumConfig;
}
//# sourceMappingURL=self-improvement.d.ts.map
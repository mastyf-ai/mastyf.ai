import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface FederatedModelDelta {
    deltaId: string;
    modelVersion: string;
    signatureHash: string;
    sampleCount: number;
    privacyBudgetEpsilon: number;
    createdAt: string;
}
export interface FederatedRolloutDecision {
    rolloutId: string;
    modelVersion: string;
    stage: 'canary' | 'partial' | 'full';
    approved: boolean;
    reason: string;
}
export interface OnnxInferenceResult {
    score: number;
    label: 'benign' | 'injection' | 'exfil';
    modelVersion: string;
    backend: 'onnxruntime' | 'aggregated-weights';
}
export declare class FederatedLearningCoordinator {
    private readonly approvalGate?;
    private readonly bandit?;
    private readonly store?;
    private deltas;
    private activeVersion;
    private aggregatedContributors;
    private pendingRolloutApprovalId;
    private rolloutStage;
    private blockedSampleCount;
    private activeWeights;
    private pendingGradients;
    constructor(approvalGate?: import("../core.js").ApprovalGate | undefined, bandit?: import("../rl/contextual-bandit.js").ContextualBanditPolicyTuner | undefined, store?: IndustryStandardStore | undefined);
    isEnabled(): boolean;
    submitLocalDelta(params: {
        signatureHash: string;
        sampleCount: number;
        privacyBudgetEpsilon?: number;
    }): FederatedModelDelta | null;
    /** Record gradient contribution from blocked detection features (B3 FedAvg path). */
    recordBlockedFeatures(features: number[], sampleCount?: number): void;
    /** Auto-collect from blocked detections (B3 hot path feeding). */
    recordBlockedSignature(signatureHash: string, features?: number[]): FederatedModelDelta | null;
    /** A/B traffic split for federated model routing (B3 rollout). */
    shouldRouteToFederatedModel(requestId: string): boolean;
    getRolloutStage(): typeof this.rolloutStage;
    /** Pull remote contributor deltas from threat mesh before aggregation (B3). */
    syncRemoteDeltas(): Promise<number>;
    aggregateDeltas(minContributors?: number): {
        aggregated: boolean;
        contributorCount: number;
        newVersion?: string;
        rollout?: FederatedRolloutDecision;
    };
    approvePendingRollout(requestId: string): FederatedRolloutDecision | null;
    /** Advance canary → partial → full after validation window (B3 rollout stages). */
    promoteRolloutStage(): FederatedRolloutDecision | null;
    proposeRollout(approved: boolean): FederatedRolloutDecision;
    getActiveVersion(): string;
    getStats(): {
        deltaCount: number;
        aggregatedContributors: number;
        activeVersion: string;
    };
    getActiveWeights(): number[] | null;
    /** ONNX inference hook — tries onnxruntime-node when model path configured, else federated weight scorer */
    runOnnxInference(features: number[]): Promise<OnnxInferenceResult | null>;
    /** Export deployable model bundle for cross-replica rollout (B3). */
    exportModelBundle(): {
        modelVersion: string;
        weights: number[];
        rolloutStage: string;
        stats: ReturnType<FederatedLearningCoordinator['getStats']>;
    };
    /** Import aggregated weights from mesh or offline training (B3). */
    importModelBundle(bundle: {
        modelVersion: string;
        weights: number[];
    }): void;
}
//# sourceMappingURL=federated-learning.d.ts.map
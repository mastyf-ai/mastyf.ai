export declare const FEDERATED_WEIGHT_DIM = 32;
/** Deterministic embedding of a threat signature hash into a normalized weight vector. */
export declare function signatureToWeightVector(signatureHash: string, dim?: number): number[];
export interface WeightContribution {
    signatureHash: string;
    sampleCount: number;
}
/** Sample-weighted secure average with optional differential-privacy noise on the aggregate. */
export declare function secureAggregateWeightVectors(contributions: WeightContribution[], epsilon?: number): {
    weights: number[];
    contributorCount: number;
};
/** Dot-product score against aggregated federated weights (inference hot path). */
export declare function scoreWithAggregatedWeights(features: number[], weights: number[]): number;
//# sourceMappingURL=federated-weight-aggregation.d.ts.map
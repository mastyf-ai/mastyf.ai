export interface GradientContribution {
    gradient: number[];
    sampleCount: number;
}
/** Local SGD step for binary threat classifier (injection=1, benign=0). */
export declare function computeLocalGradient(features: number[], label: 0 | 1, weights: number[], learningRate?: number): number[];
/** Sample-weighted FedAvg with optional DP noise on each dimension. */
export declare function fedAvgGradients(contributions: GradientContribution[], epsilon?: number): number[];
/** Apply aggregated gradient to current weight vector. */
export declare function applyGradientToWeights(weights: number[], gradient: number[]): number[];
//# sourceMappingURL=federated-gradient-aggregation.d.ts.map
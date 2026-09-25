/** Mask a local gradient before upload to aggregator. */
export declare function maskGradientForUpload(gradient: number[], participantId: string, peerIds: string[], roundId: string): number[];
/** Unmask aggregated sum — pairwise masks cancel when all parties contributed. */
export declare function unmaskAggregatedGradients(summedMasked: number[], participantIds: string[], roundId: string): number[];
export declare function sumMaskedGradients(masked: number[][]): number[];
//# sourceMappingURL=federated-masked-aggregation.d.ts.map
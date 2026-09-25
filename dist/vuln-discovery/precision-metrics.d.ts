export type PrecisionEventKind = 'soft_deny_skip' | 'noise_reject' | 'finding_emit' | 'promoted' | 'disclosed';
export interface PrecisionBucket {
    scanner: string;
    softDenySkip: number;
    noiseReject: number;
    findingEmit: number;
    promoted: number;
    disclosed: number;
}
export declare function recordPrecisionEvent(scanner: string, kind: PrecisionEventKind): void;
export declare function getPrecisionMetrics(): PrecisionBucket[];
export declare function novelPrecisionSummary(): {
    softDenySkip: number;
    noiseReject: number;
    findingEmit: number;
    promoted: number;
    byScanner: PrecisionBucket[];
};
export declare function resetPrecisionMetricsForTests(): void;
//# sourceMappingURL=precision-metrics.d.ts.map
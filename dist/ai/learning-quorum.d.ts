export interface LabelEvent {
    userId: string;
    accept: boolean;
    ts: string;
    weight: number;
}
export interface FingerprintLabels {
    fingerprint: string;
    ruleName: string;
    pattern?: string;
    outcomes: LabelEvent[];
}
export interface QuorumConfig {
    minDistinctLabelers: number;
    minTotalLabels: number;
    defaultLabelWeight: number;
    adminLabelWeight: number;
    adminUsers: Set<string>;
    maxLabelsPerHourPerUser: number;
}
export declare function getQuorumConfig(): QuorumConfig;
export declare function learningFingerprint(ruleName: string, pattern?: string): string;
export declare function resolveLabelUserId(userId?: string): string;
/** Rapid same-user bursts (max 3/hour per fingerprint) count as one effective label. */
export declare function effectiveLabelWeight(events: LabelEvent[], userId: string, cfg: QuorumConfig): number;
export declare function appendLabelEvent(store: Record<string, FingerprintLabels>, opts: {
    ruleName: string;
    pattern?: string;
    userId: string;
    accept: boolean;
    ts?: string;
}): FingerprintLabels;
export declare function quorumStats(labels: FingerprintLabels, cfg?: QuorumConfig): {
    distinctLabelers: number;
    totalWeighted: number;
    weightedAccept: number;
    weightedReject: number;
    acceptRatio: number;
    met: boolean;
};
export declare function logQuorumPending(fingerprint: string, ruleName: string, stats: ReturnType<typeof quorumStats>): void;
export declare function isDangerousUnblockPattern(ruleName: string, pattern?: string): boolean;
export declare function wouldDisableDangerousBlocking(ruleName: string, pattern: string | undefined, accept: boolean): boolean;
//# sourceMappingURL=learning-quorum.d.ts.map
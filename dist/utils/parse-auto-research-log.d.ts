export type AutoResearchBatchOutcome = {
    written: number;
    attempted: number;
    skips: {
        duplicate: number;
        belowMinConfidence: number;
        replayFailed: number;
        llmUnavailable: number;
        llmDiscoveryNull: number;
        other: number;
    };
    summaryLine: string | null;
};
export declare function parseAutoResearchLogTail(logTail: string | null | undefined): AutoResearchBatchOutcome;
//# sourceMappingURL=parse-auto-research-log.d.ts.map
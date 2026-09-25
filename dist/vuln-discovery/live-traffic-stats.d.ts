export interface LiveTrafficStat {
    key: string;
    serverName: string;
    toolName: string;
    allowCount: number;
    maliciousShapedCount: number;
    softDenyCount: number;
    lastSeenAt: string;
}
/** Force re-merge from disk so dashboard sees fleet child writes. */
export declare function reloadLiveTrafficStatsFromDisk(): void;
export declare function recordLiveAllow(serverName: string, toolName: string): void;
export declare function recordMaliciousShaped(serverName: string, toolName: string): void;
export declare function recordSoftDenySeen(serverName: string, toolName: string): void;
export declare function getLiveTrafficStats(): LiveTrafficStat[];
export declare function hotnessScore(serverName: string, toolName: string): number;
/** Sort tools so hottest (for this server) come first. */
export declare function sortToolsByLiveHotness<T extends {
    name: string;
}>(serverName: string, tools: T[]): T[];
export declare function resetLiveTrafficStatsForTests(): void;
//# sourceMappingURL=live-traffic-stats.d.ts.map
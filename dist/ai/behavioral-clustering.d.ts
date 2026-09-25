export interface FeatureVector {
    /** Shannon entropy of the tool name. */
    toolNameEntropy: number;
    /** Recursive depth of argument tree (normalized). */
    argDepth: number;
    /** Hash of keyPath pattern (normalized to 0-1). */
    keyPathHash: number;
    /** Time since last call in seconds (normalized). */
    timeSinceLastCall: number;
    /** Block rate in last 10 minutes (0-1). */
    blockRateLast10min: number;
}
export interface ClusteredCall {
    id: string;
    vector: FeatureVector;
    clusterId: number;
    label?: string;
    isNovel: boolean;
    confidence: number;
    timestamp: string;
}
export interface ClusterSummary {
    clusterId: number;
    label: string;
    size: number;
    centroid: FeatureVector;
    isNovel: boolean;
    firstSeen: string;
    lastSeen: string;
}
export declare function extractFeatureVector(toolName: string, args: Record<string, unknown> | undefined, keyPath: string, serverName: string): FeatureVector;
/**
 * Record a tool call for behavioral clustering.
 * Clusters are recomputed every N calls (default: 50).
 */
export declare function recordBehavioralCall(toolName: string, args: Record<string, unknown> | undefined, keyPath: string, serverName: string, callId: string): void;
export declare function getClusterSummaries(): ClusterSummary[];
export declare function getNovelClusters(): ClusterSummary[];
/** Attempt to auto-label clusters via known attack pattern knowledge. */
export declare function autoLabelCluster(clusterId: number, label: string): void;
export declare function resetForTests(): void;
//# sourceMappingURL=behavioral-clustering.d.ts.map
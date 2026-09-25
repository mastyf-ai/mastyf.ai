export interface ArgumentLayerScore {
    /** Number of critical-severity issues found. */
    criticalCount: number;
    /** Number of warning-severity issues found. */
    warningCount: number;
    /** Total number of issues found. */
    totalIssues: number;
    /** Highest individual issue confidence. */
    maxConfidence: number;
    /** Weighted score — higher = more suspicious. */
    score: number;
    /** Category distribution (category → count). */
    categories: Record<string, number>;
}
export interface BaselineLayerScore {
    /** Whether a behavioral baseline exists for this tool. */
    baselineExists: boolean;
    /** How many standard deviations from the baseline mean. */
    sigmaDeviation: number;
    /** Which features deviate most (0–5 per dimension). */
    deviatingFeatures: string[];
    /** Weighted score — higher = more anomalous. */
    score: number;
}
export interface IntentGraphScore {
    /** Whether a kill chain was detected in this session. */
    killChainDetected: boolean;
    /** The kill-chain pattern matched (e.g. 'read-encode-exfil'). */
    killChainPattern: string | null;
    /** Confidence of the kill-chain match. */
    chainConfidence: number;
    /** Number of previous suspicious calls in this session. */
    sessionSuspiciousCalls: number;
    /** Weighted score — higher = more suspicious. */
    score: number;
}
export interface AnomalyScore {
    /** 0–1 overall anomaly confidence. */
    confidence: number;
    /** Individual layer breakdown. */
    layers: {
        argument: ArgumentLayerScore;
        baseline: BaselineLayerScore;
        intent: IntentGraphScore;
    };
    /** Which layer contributed most. */
    primaryLayer: 'argument' | 'baseline' | 'intent' | 'none';
    /** Whether the score exceeds the adaptive threshold. */
    aboveThreshold: boolean;
    /** Adaptive threshold used for comparison. */
    adaptiveThreshold: number;
    /** Per-tool anomaly history sample count. */
    sampleCount: number;
}
interface ToolProfile {
    toolName: string;
    serverName: string;
    samples: SampleRecord[];
    /** Rolling mean of argument scan issue counts. */
    argMean: number;
    /** Rolling std dev of argument scan issue counts. */
    argStd: number;
    /** Rolling mean of critical issues. */
    critMean: number;
    /** Rolling std dev of critical issues. */
    critStd: number;
    createdAt: number;
    lastUpdated: number;
}
interface SampleRecord {
    timestamp: number;
    argIssues: number;
    criticalIssues: number;
    warningIssues: number;
    maxConfidence: number;
    categories: Record<string, number>;
    anomalyScore: number;
    wasBlocked: boolean;
}
interface SessionTracker {
    sessionKey: string;
    tenantId: string;
    calls: Array<{
        toolName: string;
        timestamp: number;
        suspicious: boolean;
        anomalyScore: number;
    }>;
    killChainProgress: number;
    createdAt: number;
}
export declare function getAnomalyDetector(): AnomalyDetector;
export declare function resetAnomalyDetectorForTests(): void;
export declare class AnomalyDetector {
    /** Per-(server, tool) behavioral profiles. */
    private profiles;
    /** Per-session intent trackers. */
    private sessions;
    /** Cached adaptive threshold from SelfImprovement. */
    private cachedThreshold;
    /** Whether anomaly detection is licensed (Pro 'ai' feature). */
    private licensed;
    private lastThresholdCheck;
    /** Build a profile key from serverName + toolName. */
    private profileKey;
    /** Check if Pro license has 'ai' feature. Cached for 30s. */
    private isLicensed;
    /** Refresh the cached adaptive threshold from the SelfImprovement engine. */
    refreshThreshold(): Promise<void>;
    /**
     * Score argument scanner results. Higher score = more suspicious args.
     * Critical issues weight 3× more than warnings.
     */
    private scoreArgumentLayer;
    /**
     * Score deviation from per-tool behavioral baselines.
     * Uses rolling z-score: (current - mean) / stdDev.
     * Returns { sigma, score } where score > 0.5 indicates significant deviation.
     */
    private scoreBaselineLayer;
    /**
     * Score based on session-wide intent graph and kill-chain progression.
     * Each previously-suspicious call in the session increases the score.
     */
    private scoreIntentLayer;
    /**
     * Record a tool call result for per-tool behavioral profiling.
     */
    recordCall(serverName: string, toolName: string, argIssues: number, criticalIssues: number, warningIssues: number, maxConfidence: number, categories: Record<string, number>, anomalyScore: number, wasBlocked: boolean): void;
    /** Recompute rolling mean and std dev for a profile. */
    private recomputeProfileStats;
    /** Get profile for a tool (read-only). */
    getProfile(serverName: string, toolName: string): ToolProfile | undefined;
    /** Start or get a session intent tracker. */
    ensureSession(sessionKey: string, tenantId: string): SessionTracker;
    /** Record a tool call within a session for kill-chain analysis. */
    trackSessionCall(sessionKey: string, tenantId: string, toolName: string, suspicious: boolean, anomalyScore: number): void;
    getSession(sessionKey: string): SessionTracker | undefined;
    /**
     * Evaluate a tool call and produce a unified anomaly score (0–1).
     * This is the main entry point for the policy engine.
     *
     * @param serverName  MCP server name
     * @param toolName    Tool being called
     * @param criticalCount  Number of critical issues from argument scanner
     * @param warningCount   Number of warning issues from argument scanner
     * @param maxConfidence  Highest individual issue confidence
     * @param categories     Category distribution from argument scanner
     * @param sessionKey     Session key for intent tracking (null = no tracking)
     * @param tenantId       Tenant identifier
     */
    evaluate(serverName: string, toolName: string, criticalCount: number, warningCount: number, maxConfidence: number, categories: Record<string, number>, sessionKey: string | null, tenantId: string): Promise<AnomalyScore>;
    /** Get all loaded profiles (for dashboard/tests). */
    getAllProfiles(): ToolProfile[];
    /** Get all active sessions (for dashboard/tests). */
    getAllSessions(): SessionTracker[];
    /** Clear all profiles and sessions (for tests). */
    reset(): void;
}
export {};
//# sourceMappingURL=anomaly-detector.d.ts.map
import { ProxyCallRecord } from '../types.js';
import { PolicyRule } from '../policy/policy-types.js';
export interface BaselineProfile {
    serverName: string;
    toolName: string;
    sampleCount: number;
    avgTokens: number;
    stddevTokens: number;
    avgLatencyMs: number;
    stddevLatencyMs: number;
    /** Hour-of-day distribution — index 0 = midnight hour */
    hourlyDistribution: number[];
    /** Common argument keys seen for this tool */
    argumentKeys: string[];
    /** First seen timestamp */
    firstSeen: string;
    /** Last updated */
    lastUpdated: string;
}
export interface AnomalySuggestion {
    rule: PolicyRule;
    confidence: number;
    reason: string;
    source: 'baseline';
}
export declare class BaselineLearner {
    private baselines;
    private readonly defaultZThreshold;
    private sharedStore;
    /** Enable shared PostgreSQL-backed baseline persistence */
    setSharedStore(store: any): void;
    /** Load baselines from shared PG store */
    loadFromSharedStore(): Promise<void>;
    /** Persist a baseline to shared PG store */
    private persistToShared;
    /** Compute or update baselines from call records */
    learn(records: ProxyCallRecord[]): void;
    /** Detect deviations in live calls against baselines */
    detectDeviations(live: {
        serverName: string;
        toolName: string;
        totalTokens: number;
        durationMs: number;
        timestamp: string;
    }): {
        zScoreTokens: number;
        zScoreLatency: number;
        isAnomaly: boolean;
    };
    /** Generate anomaly-based policy rule suggestions */
    suggestRules(records: ProxyCallRecord[]): AnomalySuggestion[];
    /**
     * Preventive hardening from stable baselines when no spikes/rate anomalies were found.
     * Surfaces actionable policy ideas so learning cycles are not empty for healthy traffic.
     */
    suggestPreventiveRules(maxSuggestions?: number): AnomalySuggestion[];
    getBaseline(key: string): BaselineProfile | undefined;
    getAllBaselines(): BaselineProfile[];
    loadFromFile(path?: string): number;
    saveToFile(path?: string): void;
    private mean;
    private stddev;
}
//# sourceMappingURL=baseline-learner.d.ts.map
/**
 * Pattern Analyzer — analyzes behavioral observations to identify:
 *   - Which tools are actually used (vs declared in tools/list)
 *   - Argument value ranges and types
 *   - Call frequency baselines (for rate limiting)
 *   - Tool co-occurrence anomalies (unusual tool sequences)
 *   - Peak usage periods
 */
import type { ObservationWindow, WindowStatistics } from './behavior-collector.js';
export interface ToolProfile {
    toolName: string;
    serverName: string;
    /** Total calls observed */
    callCount: number;
    /** Calls per minute (average) */
    callRatePerMin: number;
    /** Peak calls per minute */
    peakRatePerMin: number;
    /** Arguments typically used */
    argumentSchema: Record<string, {
        type: string;
        required: boolean;
        observedValues?: number;
    }>;
    /** Latency stats */
    latencyP50: number;
    latencyP95: number;
    /** Error rate */
    errorRate: number;
    /** Tools frequently called before this one */
    precedingTools: {
        tool: string;
        count: number;
    }[];
    /** Tools frequently called after this one */
    followingTools: {
        tool: string;
        count: number;
    }[];
}
export interface AnalysisResult {
    /** Window analyzed */
    windowId: string;
    /** Per-tool profiles */
    toolProfiles: ToolProfile[];
    /** Total observation count */
    totalObservations: number;
    /** Duration of the observation window in minutes */
    durationMin: number;
    /** Top tool sequences that represent normal workflows */
    normalWorkflows: {
        sequence: string[];
        count: number;
        confidence: number;
    }[];
    /** Tools that were used less than 3 times (candidates for removal) */
    unusedTools: string[];
    /** Tools with high error rates (>10%) */
    highErrorTools: string[];
}
export declare class PatternAnalyzer {
    /**
     * Analyze a completed observation window and produce tool profiles.
     */
    analyze(window: ObservationWindow, stats: WindowStatistics): AnalysisResult;
    /**
     * Build a detailed profile for a single tool.
     */
    private buildToolProfile;
    private getRelatedTools;
}
//# sourceMappingURL=pattern-analyzer.d.ts.map
import { GovernanceSnapshot } from './data-collector.js';
import { PolicyRule } from '../policy/policy-types.js';
export interface CrossLayerInsight {
    type: string;
    severity: 'info' | 'warning' | 'critical';
    description: string;
    correlatedLayers: string[];
    suggestedRule?: PolicyRule;
    confidence: number;
}
export interface TemporalPattern {
    hour: number;
    callVolume: number;
    avgTokens: number;
    toolDiversity: number;
}
/**
 * Pattern Recognizer — discovers cross-layer correlations and temporal patterns
 * across the entire governance dataset.
 */
export declare class PatternRecognizer {
    /**
     * Cross-layer analysis: correlates data across security, cost, and health layers
     * to discover non-obvious patterns.
     */
    analyze(snapshot: GovernanceSnapshot): CrossLayerInsight[];
    /**
     * Temporal pattern detection: identifies time-based usage patterns.
     */
    detectTemporalPatterns(snapshot: GovernanceSnapshot): TemporalPattern[];
    /**
     * Server relationship analysis: discovers inter-server call patterns.
     */
    analyzeServerRelationships(snapshot: GovernanceSnapshot): Map<string, string[]>;
    /**
     * Correlate package CVE posture with upstream API errors / auth flips for VDE.
     */
    correlateVulnStackSignals(input: {
        packageCves: Array<{
            packageName: string;
            cveId?: string;
            serverName: string;
        }>;
        upstreamEvents: Array<{
            url: string;
            statusFrom?: number;
            statusTo?: number;
            errorRate?: number;
            relatedServer?: string;
        }>;
        toolWatchAdds?: Array<{
            serverName: string;
            toolName: string;
        }>;
    }): CrossLayerInsight[];
}
//# sourceMappingURL=pattern-recognizer.d.ts.map
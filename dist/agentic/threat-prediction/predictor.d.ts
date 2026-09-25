/**
 * Threat Predictor — generates threat forecasts for MCP servers.
 *
 * Uses observed CVE data, risk scores, and heuristic time-series models
 * to predict exploitation likelihood over the next 30/90/365 days.
 */
import type { RiskScore } from './risk-scorer.js';
export interface ThreatForecast {
    serverName: string;
    /** Current risk score */
    currentRisk: number;
    /** Predicted risk in 30 days */
    risk30d: number;
    /** Predicted risk in 90 days */
    risk90d: number;
    /** Predicted risk in 365 days */
    risk365d: number;
    /** Probability of exploitation within next 30 days (0-1) */
    exploitationProbability: number;
    /** Top threats */
    topThreats: ThreatItem[];
    /** Recommended preemptive hardening actions */
    preemptiveActions: PreemptiveAction[];
    /** Forecast confidence (0-1) */
    confidence: number;
}
export interface ThreatItem {
    type: 'cve' | 'configuration' | 'exposure' | 'velocity';
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    likelihood: number;
}
export interface PreemptiveAction {
    action: string;
    priority: 'immediate' | 'high' | 'medium' | 'low';
    impact: string;
    effort: string;
}
export declare class ThreatPredictor {
    /**
     * Generate a threat forecast for a server based on its risk score.
     */
    forecast(riskScore: RiskScore, cveCount: number, cveTrend?: 'increasing' | 'stable' | 'decreasing'): ThreatForecast;
    /**
     * Compute the probability of exploitation within 30 days.
     */
    private computeExploitationProbability;
    /**
     * Identify the top threats for a server.
     */
    private identifyThreats;
    /**
     * Recommend preemptive hardening actions.
     */
    private recommendActions;
    /**
     * Compute forecast confidence based on available data quality.
     */
    private computeConfidence;
}
//# sourceMappingURL=predictor.d.ts.map
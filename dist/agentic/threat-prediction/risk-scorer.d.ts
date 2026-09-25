/**
 * Risk Scorer — scores each MCP server on likelihood × impact of exploitation.
 *
 * Factors:
 *   - CVSS base score from known CVEs
 *   - Exploit maturity (PoC available, actively exploited, etc.)
 *   - Package release velocity (frequent releases = higher surface area)
 *   - Tool capability risk (filesystem write > read-only APIs)
 *   - Network exposure (stdio local-only vs. HTTP/SSE remote-accessible)
 *   - Authentication posture (no auth = high risk, OAuth2 = low risk)
 */
import type { McpServerConfig } from '../../types.js';
export interface RiskScore {
    serverName: string;
    /** 0-100 composite risk score */
    overallScore: number;
    /** Individual risk factors */
    factors: RiskFactor[];
    /** Risk tier */
    tier: 'critical' | 'high' | 'medium' | 'low' | 'minimal';
    /** Predicted time-to-exploit in days (estimated) */
    predictedTte: number;
    /** Recommendation */
    recommendation: string;
}
export interface RiskFactor {
    name: string;
    score: number;
    weight: number;
    details: string;
}
export declare class RiskScorer {
    /**
     * Score a single MCP server for risk.
     */
    scoreServer(server: McpServerConfig, knownCves?: number, maxCvssScore?: number): RiskScore;
    /**
     * Score based on tool capability risk.
     * Tools that can write, execute, or delete are high-risk.
     */
    private scoreCapability;
    /**
     * Score based on network exposure.
     */
    private scoreExposure;
    private getExposureDetails;
    /** Score based on release velocity when package registry metadata has been measured. */
    private scoreVelocity;
    /**
     * Score based on authentication posture.
     */
    private scoreAuth;
    /**
     * Determine risk tier from overall score.
     */
    private determineTier;
    /**
     * Estimate time-to-exploit in days.
     */
    private estimateTte;
    /**
     * Generate a human-readable recommendation.
     */
    private generateRecommendation;
    /**
     * Compare two servers and return relative risk ranking.
     */
    compare(a: RiskScore, b: RiskScore): number;
}
//# sourceMappingURL=risk-scorer.d.ts.map
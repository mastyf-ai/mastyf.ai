/**
 * Per-Server Threat Scorer
 *
 * Computes a standardized 0-100 composite safety/threat score for an individual MCP server.
 *
 * Factors:
 *   - Block Rate (40% weight): Ratio of blocked to total calls
 *   - Exploit Severity (30% weight): Count of critical threats (shell injection, exfil, prompt injection)
 *   - Exposed Tool Risk (20% weight): Proportion of high/critical destructive tools
 *   - Threat Recency (10% weight): Threat activity in the last 60 minutes
 */
export interface ServerScoringMetrics {
    serverName: string;
    totalCalls: number;
    blockedCalls: number;
    criticalThreatCount: number;
    highRiskToolCount: number;
    recentThreats1h: number;
}
export interface ServerThreatScoreResult {
    serverName: string;
    score: number;
    tier: 'safe' | 'warning' | 'danger';
    deductions: {
        blockRateDeduction: number;
        severityDeduction: number;
        toolRiskDeduction: number;
        recencyDeduction: number;
    };
}
export declare function calculateServerThreatScore(metrics: ServerScoringMetrics): ServerThreatScoreResult;
//# sourceMappingURL=server-threat-scorer.d.ts.map
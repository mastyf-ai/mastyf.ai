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
export function calculateServerThreatScore(metrics) {
    // If server has zero calls, default to baseline 100
    if (metrics.totalCalls === 0) {
        return {
            serverName: metrics.serverName,
            score: 100,
            tier: 'safe',
            deductions: {
                blockRateDeduction: 0,
                severityDeduction: 0,
                toolRiskDeduction: 0,
                recencyDeduction: 0,
            },
        };
    }
    // 1. Block Rate deduction (max 40 pts)
    const blockRate = metrics.blockedCalls / metrics.totalCalls;
    const blockRateDeduction = Math.min(40, Math.round(blockRate * 40));
    // 2. Severity deduction (max 30 pts, 5 pts per critical exploit)
    const severityDeduction = Math.min(30, metrics.criticalThreatCount * 5);
    // 3. Tool Risk profile deduction (max 20 pts, 5 pts per high/critical tool)
    const toolRiskDeduction = Math.min(20, metrics.highRiskToolCount * 5);
    // 4. Recency deduction (max 10 pts, 2 pts per threat in the last hour)
    const recencyDeduction = Math.min(10, metrics.recentThreats1h * 2);
    const totalDeductions = blockRateDeduction + severityDeduction + toolRiskDeduction + recencyDeduction;
    const finalScore = Math.max(0, Math.min(100, 100 - totalDeductions));
    let tier = 'safe';
    if (finalScore < 50) {
        tier = 'danger';
    }
    else if (finalScore < 80) {
        tier = 'warning';
    }
    return {
        serverName: metrics.serverName,
        score: finalScore,
        tier,
        deductions: {
            blockRateDeduction,
            severityDeduction,
            toolRiskDeduction,
            recencyDeduction,
        },
    };
}
//# sourceMappingURL=server-threat-scorer.js.map
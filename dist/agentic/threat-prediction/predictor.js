/**
 * Threat Predictor — generates threat forecasts for MCP servers.
 *
 * Uses observed CVE data, risk scores, and heuristic time-series models
 * to predict exploitation likelihood over the next 30/90/365 days.
 */
export class ThreatPredictor {
    /**
     * Generate a threat forecast for a server based on its risk score.
     */
    forecast(riskScore, cveCount, cveTrend = 'stable') {
        const currentRisk = riskScore.overallScore;
        // Risk projection based on CVE trend
        const trendMultiplier = cveTrend === 'increasing' ? 1.3 : cveTrend === 'decreasing' ? 0.7 : 1.0;
        // Exponential decay model for risk increase over time
        const risk30d = Math.min(Math.round(currentRisk * (1 + 0.1 * trendMultiplier)), 100);
        const risk90d = Math.min(Math.round(currentRisk * (1 + 0.3 * trendMultiplier)), 100);
        const risk365d = Math.min(Math.round(currentRisk * (1 + 0.8 * trendMultiplier)), 100);
        // Exploitation probability
        const exploitationProbability = this.computeExploitationProbability(riskScore, cveCount);
        // Top threats
        const topThreats = this.identifyThreats(riskScore, cveCount, cveTrend);
        // Preemptive actions
        const preemptiveActions = this.recommendActions(riskScore, topThreats);
        // Confidence based on data quality
        const confidence = this.computeConfidence(riskScore, cveCount);
        return {
            serverName: riskScore.serverName,
            currentRisk,
            risk30d,
            risk90d,
            risk365d,
            exploitationProbability,
            topThreats,
            preemptiveActions,
            confidence,
        };
    }
    /**
     * Compute the probability of exploitation within 30 days.
     */
    computeExploitationProbability(risk, _cveCount) {
        let prob = 0;
        // Base probability from risk score
        if (risk.overallScore >= 75)
            prob = 0.60;
        else if (risk.overallScore >= 50)
            prob = 0.30;
        else if (risk.overallScore >= 25)
            prob = 0.10;
        else
            prob = 0.02;
        // Factor adjustments
        for (const factor of risk.factors) {
            if (factor.name === 'CVE Exposure' && factor.score > 50)
                prob += 0.15;
            if (factor.name === 'Network Exposure' && factor.score > 50)
                prob += 0.10;
            if (factor.name === 'Authentication Posture' && factor.score > 50)
                prob += 0.10;
        }
        return Math.round(Math.min(prob, 0.95) * 100) / 100;
    }
    /**
     * Identify the top threats for a server.
     */
    identifyThreats(risk, cveCount, cveTrend) {
        const threats = [];
        // CVE threats
        if (cveCount > 0) {
            const cveFactor = risk.factors.find(f => f.name === 'CVE Exposure');
            threats.push({
                type: 'cve',
                description: `${cveCount} known CVEs (trend: ${cveTrend})`,
                severity: cveCount >= 5 ? 'critical' : cveCount >= 2 ? 'high' : 'medium',
                likelihood: cveFactor?.score ? cveFactor.score / 100 : 0.5,
            });
        }
        // Exposure threats
        const exposureFactor = risk.factors.find(f => f.name === 'Network Exposure');
        if (exposureFactor && exposureFactor.score > 50) {
            threats.push({
                type: 'exposure',
                description: exposureFactor.details,
                severity: exposureFactor.score > 70 ? 'critical' : 'high',
                likelihood: exposureFactor.score / 100,
            });
        }
        // Auth threats
        const authFactor = risk.factors.find(f => f.name === 'Authentication Posture');
        if (authFactor && authFactor.score > 30) {
            threats.push({
                type: 'configuration',
                description: authFactor.details,
                severity: authFactor.score > 60 ? 'critical' : 'high',
                likelihood: authFactor.score / 100,
            });
        }
        // Capability threats
        const capFactor = risk.factors.find(f => f.name === 'Tool Capability Risk');
        if (capFactor && capFactor.score > 50) {
            threats.push({
                type: 'configuration',
                description: `High-risk tool capabilities detected — ${capFactor.details}`,
                severity: 'high',
                likelihood: capFactor.score / 100,
            });
        }
        return threats.sort((a, b) => {
            const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            return severityOrder[a.severity] - severityOrder[b.severity];
        }).slice(0, 5);
    }
    /**
     * Recommend preemptive hardening actions.
     */
    recommendActions(risk, threats) {
        const actions = [];
        if (risk.tier === 'critical' || risk.tier === 'high') {
            actions.push({
                action: 'Apply all available security patches immediately',
                priority: 'immediate',
                impact: 'Eliminates known CVE risk',
                effort: 'Low-Medium',
            });
            actions.push({
                action: 'Enable argument allowlist for all tools',
                priority: 'high',
                impact: 'Prevents command injection and prompt injection',
                effort: 'Medium',
            });
        }
        if (threats.some(t => t.type === 'exposure')) {
            actions.push({
                action: 'Restrict network access — use stdio transport where possible',
                priority: 'high',
                impact: 'Reduces remote attack surface',
                effort: 'Low',
            });
        }
        if (threats.some(t => t.type === 'configuration' && t.description.includes('Authentication'))) {
            actions.push({
                action: 'Configure OAuth 2.1 or API key authentication',
                priority: 'high',
                impact: 'Prevents unauthorized tool access',
                effort: 'Medium',
            });
        }
        actions.push({
            action: 'Enable MCP Mastyf AI semantic guard for high-risk tools',
            priority: 'medium',
            impact: 'Detects anomalous tool call patterns',
            effort: 'Low',
        });
        return actions;
    }
    /**
     * Compute forecast confidence based on available data quality.
     */
    computeConfidence(risk, cveCount) {
        let confidence = 0.5;
        // More CVEs = more data for prediction
        if (cveCount >= 10)
            confidence += 0.2;
        else if (cveCount >= 3)
            confidence += 0.1;
        // Well-defined risk factors increase confidence
        const definedFactors = risk.factors.filter(f => f.score > 0).length;
        confidence += definedFactors * 0.05;
        return Math.round(Math.min(confidence, 0.95) * 100) / 100;
    }
}
//# sourceMappingURL=predictor.js.map
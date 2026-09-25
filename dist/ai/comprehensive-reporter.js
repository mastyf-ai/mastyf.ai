export class ComprehensiveReporter {
    generateFullReport(snapshot, baselines, insights, temporal, autoRules, learning, pruneList) {
        // ── Executive Summary ──────────────────────────────────
        const totalSecurityScore = snapshot.securityReports.length > 0
            ? Math.round(snapshot.securityReports.reduce((s, r) => s + r.score, 0) / snapshot.securityReports.length)
            : 0;
        const topRisks = [];
        const worstOffenders = snapshot.securityReports
            .filter(s => s.score < 50)
            .map(s => s.serverName);
        for (const s of snapshot.securityReports.filter(s => s.score < 30)) {
            topRisks.push(`${s.serverName}: security score ${s.score}/100, ${s.cves.length} CVEs`);
        }
        const unhealthy = snapshot.healthReports.filter(h => h.successRate < 0.5);
        for (const h of unhealthy) {
            topRisks.push(`${h.serverName}: unhealthy (${(h.successRate * 100).toFixed(0)}% success)`);
        }
        const recommendations = [];
        // ── Security ───────────────────────────────────────────
        const securityReports = snapshot.securityReports.map(s => ({
            name: s.serverName,
            score: s.score,
            cves: s.cves.length,
            critical: s.cves.filter(c => c.severity === 'CRITICAL').length,
            auth: s.authStatus?.hasAuthentication || false,
        }));
        // ── Cost ───────────────────────────────────────────────
        const costReports = snapshot.costReports.map(c => ({
            name: c.serverName,
            tokens: c.tokensUsed,
            cost: c.estimatedCostUSD,
            trend: 'flat',
        }));
        const totalCost = costReports.reduce((s, c) => s + c.cost, 0);
        // Assumes snapshot covers one day; scale to 30-day monthly projection.
        // If the snapshot window differs, adjust the multiplier accordingly.
        const projectedMonthly = totalCost * 30;
        const budgetAlerts = [];
        // ── Health ─────────────────────────────────────────────
        const healthReports = snapshot.healthReports.map(h => ({
            name: h.serverName,
            latency: h.latencyMs,
            success: h.successRate * 100,
            tools: h.toolCount,
        }));
        const atRisk = snapshot.healthReports
            .filter(h => h.successRate < 0.7 || h.overloadWarning)
            .map(h => h.serverName);
        // ── Behavioral ─────────────────────────────────────────
        const baselineReport = baselines.map(b => ({
            server: b.serverName,
            tool: b.toolName,
            sampleCount: b.sampleCount,
            avgTokens: Math.round(b.avgTokens),
            avgLatency: Math.round(b.avgLatencyMs),
        }));
        // ── Patterns ───────────────────────────────────────────
        const patternReport = insights.map(i => ({
            type: i.type,
            severity: i.severity,
            description: i.description,
            confidence: i.confidence,
        }));
        const temporalReport = temporal
            .filter(t => t.callVolume > 0)
            .map(t => ({ hour: t.hour, volume: t.callVolume, avgTokens: t.avgTokens }));
        // ── Generate recommendations ───────────────────────────
        for (const s of worstOffenders) {
            recommendations.push({
                priority: 1,
                action: `Update or isolate ${s} — security score ${snapshot.securityReports.find(r => r.serverName === s)?.score || 0}`,
                impact: 'Prevent CVE exploitation',
                confidence: 0.9,
            });
        }
        for (const h of unhealthy) {
            recommendations.push({
                priority: 2,
                action: `Investigate health issues on ${h.serverName} (${(h.successRate * 100).toFixed(0)}% success)`,
                impact: 'Restore service reliability',
                confidence: 0.8,
            });
        }
        for (const i of insights) {
            if (i.severity === 'critical' && i.suggestedRule) {
                recommendations.push({
                    priority: 1,
                    action: i.description,
                    impact: 'Cross-layer risk mitigation',
                    confidence: i.confidence,
                });
            }
        }
        if (pruneList.length > 0) {
            recommendations.push({
                priority: 3,
                action: `Consider pruning ${pruneList.length} ineffective auto-generated rules: ${pruneList.slice(0, 3).join(', ')}`,
                impact: 'Reduce policy noise',
                confidence: 0.7,
            });
        }
        return {
            timestamp: snapshot.timestamp,
            executiveSummary: {
                overallScore: totalSecurityScore,
                totalCost,
                topRisks: topRisks.slice(0, 5),
                activeServers: snapshot.metadata.activeServers.length,
                blockedCalls: snapshot.metadata.blockedCalls,
                recommendations: recommendations.slice(0, 5).map(r => r.action),
            },
            security: { serverReports: securityReports, worstOffenders },
            cost: { serverReports: costReports, projectedMonthly, budgetAlerts },
            health: { serverReports: healthReports, atRisk },
            behavioral: { baselines: baselineReport, anomalies: [] },
            patterns: { crossLayerInsights: patternReport, temporal: temporalReport },
            policy: { activeRules: [], autoGeneratedRules: autoRules, prunedRules: pruneList },
            aiState: {
                adaptiveThreshold: learning.adaptiveThreshold,
                truePositiveRate: learning.truePositiveRate,
                falsePositiveRate: learning.falsePositiveRate,
                moduleWeights: learning.moduleWeights,
            },
            recommendations,
        };
    }
    toMarkdown(report) {
        const lines = [];
        lines.push(`# MCP Mastyf AI — AI-Driven Comprehensive Report`);
        lines.push(`**${report.timestamp}** | Score: ${report.executiveSummary.overallScore}/100 | Cost: $${report.executiveSummary.totalCost.toFixed(4)}`);
        lines.push('');
        lines.push('## Executive Summary');
        lines.push(`- Active servers: ${report.executiveSummary.activeServers}`);
        lines.push(`- Blocked calls: ${report.executiveSummary.blockedCalls}`);
        lines.push(`- AI threshold: ${report.aiState.adaptiveThreshold.toFixed(2)}`);
        if (report.executiveSummary.topRisks.length > 0) {
            lines.push('### Top Risks');
            for (const r of report.executiveSummary.topRisks)
                lines.push(`- ⚠️ ${r}`);
        }
        lines.push('');
        lines.push('## Security');
        for (const s of report.security.serverReports) {
            const icon = s.score < 30 ? '🔴' : s.score < 60 ? '🟡' : '🟢';
            lines.push(`- ${icon} **${s.name}**: ${s.score}/100, ${s.cves} CVEs (${s.critical} critical), auth: ${s.auth ? '✅' : '❌'}`);
        }
        lines.push('');
        lines.push('## Cost');
        for (const c of report.cost.serverReports) {
            lines.push(`- **${c.name}**: ${c.tokens.toLocaleString()} tokens, $${c.cost.toFixed(4)}`);
        }
        lines.push(`**Projected monthly:** $${report.cost.projectedMonthly.toFixed(2)}`);
        lines.push('');
        lines.push('## Health');
        for (const h of report.health.serverReports) {
            lines.push(`- **${h.name}**: ${h.latency}ms, ${h.success.toFixed(0)}% success, ${h.tools} tools`);
        }
        lines.push('');
        lines.push('## Cross-Layer Insights');
        for (const p of report.patterns.crossLayerInsights) {
            lines.push(`- [${p.severity}] ${p.description} (confidence: ${(p.confidence * 100).toFixed(0)}%)`);
        }
        lines.push('');
        lines.push('## AI Self-Improvement');
        lines.push(`- Adaptive threshold: ${report.aiState.adaptiveThreshold.toFixed(2)}`);
        lines.push(`- True positive rate: ${(report.aiState.truePositiveRate * 100).toFixed(0)}%`);
        lines.push(`- False positive rate: ${(report.aiState.falsePositiveRate * 100).toFixed(0)}%`);
        lines.push('');
        lines.push('## Recommendations');
        for (const r of report.recommendations) {
            lines.push(`1. **[P${r.priority}]** ${r.action} — ${r.impact} (${(r.confidence * 100).toFixed(0)}%)`);
        }
        return lines.join('\n');
    }
    /** Plain-text report for TUI and logs (no markdown). */
    toPlainText(report) {
        const lines = [];
        lines.push('MCP Mastyf AI — Comprehensive Analysis');
        lines.push(`Generated: ${report.timestamp}`);
        lines.push('');
        lines.push('EXECUTIVE SUMMARY');
        lines.push(`  Overall security score: ${report.executiveSummary.overallScore}/100`);
        lines.push(`  Active servers: ${report.executiveSummary.activeServers}`);
        lines.push(`  Blocked calls: ${report.executiveSummary.blockedCalls}`);
        lines.push(`  Total cost (snapshot): $${report.executiveSummary.totalCost.toFixed(4)}`);
        lines.push(`  AI adaptive threshold: ${report.aiState.adaptiveThreshold.toFixed(2)}`);
        lines.push(`  True positive rate: ${(report.aiState.truePositiveRate * 100).toFixed(0)}%`);
        lines.push(`  False positive rate: ${(report.aiState.falsePositiveRate * 100).toFixed(0)}%`);
        if (report.executiveSummary.topRisks.length > 0) {
            lines.push('');
            lines.push('TOP RISKS');
            for (const r of report.executiveSummary.topRisks)
                lines.push(`  - ${r}`);
        }
        if (report.executiveSummary.recommendations.length > 0) {
            lines.push('');
            lines.push('SUMMARY RECOMMENDATIONS');
            for (const r of report.executiveSummary.recommendations)
                lines.push(`  - ${r}`);
        }
        lines.push('');
        lines.push('SECURITY');
        for (const s of report.security.serverReports) {
            lines.push(`  ${s.name}: score ${s.score}/100, ${s.cves} CVE(s) (${s.critical} critical), auth ${s.auth ? 'yes' : 'no'}`);
        }
        if (report.security.worstOffenders.length > 0) {
            lines.push(`  Worst offenders: ${report.security.worstOffenders.join(', ')}`);
        }
        lines.push('');
        lines.push('COST');
        for (const c of report.cost.serverReports) {
            lines.push(`  ${c.name}: ${c.tokens.toLocaleString()} tokens, $${c.cost.toFixed(4)}, trend ${c.trend}`);
        }
        lines.push(`  Projected monthly: $${report.cost.projectedMonthly.toFixed(2)}`);
        for (const a of report.cost.budgetAlerts)
            lines.push(`  Alert: ${a}`);
        lines.push('');
        lines.push('HEALTH');
        for (const h of report.health.serverReports) {
            lines.push(`  ${h.name}: ${h.latency}ms latency, ${h.success.toFixed(0)}% success, ${h.tools} tools`);
        }
        if (report.health.atRisk.length > 0) {
            lines.push(`  At risk: ${report.health.atRisk.join(', ')}`);
        }
        if (report.behavioral.baselines.length > 0) {
            lines.push('');
            lines.push('BEHAVIORAL BASELINES');
            for (const b of report.behavioral.baselines.slice(0, 12)) {
                lines.push(`  ${b.server}/${b.tool}: ${b.sampleCount} samples, ~${b.avgTokens} tokens, ~${b.avgLatency}ms`);
            }
            if (report.behavioral.baselines.length > 12) {
                lines.push(`  ... and ${report.behavioral.baselines.length - 12} more baselines`);
            }
        }
        if (report.patterns.crossLayerInsights.length > 0) {
            lines.push('');
            lines.push('CROSS-LAYER INSIGHTS');
            for (const p of report.patterns.crossLayerInsights) {
                lines.push(`  [${p.severity}] ${p.description} (confidence ${(p.confidence * 100).toFixed(0)}%)`);
            }
        }
        if (report.recommendations.length > 0) {
            lines.push('');
            lines.push('PRIORITIZED ACTIONS');
            for (const r of report.recommendations) {
                lines.push(`  [P${r.priority}] ${r.action}`);
                lines.push(`         Impact: ${r.impact} (${(r.confidence * 100).toFixed(0)}% confidence)`);
            }
        }
        if (report.policy.autoGeneratedRules.length > 0) {
            lines.push('');
            lines.push('AUTO-GENERATED POLICY RULES');
            for (const rule of report.policy.autoGeneratedRules.slice(0, 10))
                lines.push(`  - ${rule}`);
        }
        return lines.join('\n');
    }
}
//# sourceMappingURL=comprehensive-reporter.js.map
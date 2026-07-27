import { GovernanceSnapshot } from './data-collector.js';
import { PolicyRule, PolicyAction } from '../policy/policy-types.js';
import { Logger } from '../utils/logger.js';

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
export class PatternRecognizer {
  /**
   * Cross-layer analysis: correlates data across security, cost, and health layers
   * to discover non-obvious patterns.
   */
  analyze(snapshot: GovernanceSnapshot): CrossLayerInsight[] {
    const insights: CrossLayerInsight[] = [];

    // ── Health degradation → cost correlation ─────
    for (const health of snapshot.healthReports) {
      if (!health.successRate || health.successRate < 0.5) {
        // Check if this server has cost data
        const costReport = snapshot.costReports.find(c => c.serverName === health.serverName);
        if (costReport && costReport.estimatedCostUSD > 0) {
          insights.push({
            type: 'health-cost-correlation',
            severity: 'warning',
            description: `${health.serverName} has low success rate (${(health.successRate * 100).toFixed(0)}%) while still incurring costs ($${costReport.estimatedCostUSD.toFixed(4)}). Consider circuit-breaking or disabling until health recovers.`,
            correlatedLayers: ['health', 'cost'],
            suggestedRule: {
              name: `auto-circuit-break-${health.serverName}`,
              description: `Auto-generated: Disable ${health.serverName} when success rate < 50%`,
              action: 'block',
              maxCallsPerMinute: 1,
            },
            confidence: 0.8,
          });
        }
      }
    }

    // ── Moderate security score — hardening opportunity ─────
    for (const sec of snapshot.securityReports) {
      if (sec.score >= 30 && sec.score < 70) {
        insights.push({
          type: 'security-hardening',
          severity: 'info',
          description: `${sec.serverName} security score is ${sec.score}/100 (below 70). Review tool permissions, CVEs, and policy rules before production use.`,
          correlatedLayers: ['security'],
          confidence: 0.65,
        });
      }
    }

    // ── Security risk + high cost = urgent ─────
    for (const sec of snapshot.securityReports) {
      if (sec.score < 30) {
        const costReport = snapshot.costReports.find(c => c.serverName === sec.serverName);
        if (costReport && costReport.estimatedCostUSD > 0) {
          insights.push({
            type: 'security-cost-risk',
            severity: 'critical',
            description: `${sec.serverName} has critically low security score (${sec.score}) but active cost (${
              costReport.estimatedCostUSD.toFixed(4)
            }). High risk: spending on a vulnerable server.`,
            correlatedLayers: ['security', 'cost'],
            suggestedRule: {
              name: `auto-secure-${sec.serverName}`,
              description: `Auto-generated: Block all calls to ${sec.serverName} until security score improves above 50`,
              action: 'block',
              tools: { deny: [sec.serverName] },
            },
            confidence: 0.9,
          });
        }
      }
    }

    // ── CVE discovery → call pattern shift ─────
    for (const sec of snapshot.securityReports) {
      if (sec.cves.length > 0) {
        const records = snapshot.callRecords.filter(r => r.serverName === sec.serverName);
        if (records.length > 5) {
          const half = Math.ceil(records.length / 2);
          const recentHalf = records.slice(-half);
          const olderHalf = records.slice(0, half);
          const recentAvg = recentHalf.length > 0 ? recentHalf.reduce((s, r) => s + r.totalTokens, 0) / recentHalf.length : 0;
          const olderAvg = olderHalf.length > 0 ? olderHalf.reduce((s, r) => s + r.totalTokens, 0) / olderHalf.length : 0;
          if (olderAvg > 0 && recentAvg < olderAvg * 0.5) {
            insights.push({
              type: 'cve-induced-shift',
              severity: 'info',
              description: `${sec.serverName}: Call volume dropped ${((1 - recentAvg / olderAvg) * 100).toFixed(0)}% — possibly agents avoiding this server due to ${sec.cves.length} known CVEs.`,
              correlatedLayers: ['security', 'behavioral'],
              confidence: 0.6,
            });
          }
        }
      }
    }

    // ── Circuit breaker events → security scan correlation ─────
    const unhealthy = snapshot.healthReports.filter(h => h.successRate < 0.5);
    for (const h of unhealthy) {
      const sec = snapshot.securityReports.find(s => s.serverName === h.serverName);
      if (sec && sec.cves.length > 0) {
        insights.push({
          type: 'health-security-link',
          severity: 'warning',
          description: `${h.serverName} is both unhealthy (${(h.successRate * 100).toFixed(0)}% success) and has ${sec.cves.length} CVEs. The health issues may be security-related.`,
          correlatedLayers: ['health', 'security'],
          confidence: 0.7,
        });
      }
    }

    return insights;
  }

  /**
   * Temporal pattern detection: identifies time-based usage patterns.
   */
  detectTemporalPatterns(snapshot: GovernanceSnapshot): TemporalPattern[] {
    const hourly = new Map<number, { calls: number; totalTokens: number; tools: Set<string> }>();
    for (let h = 0; h < 24; h++) hourly.set(h, { calls: 0, totalTokens: 0, tools: new Set() });

    for (const r of snapshot.callRecords) {
      const h = new Date(r.timestamp).getHours();
      if (h >= 0 && h < 24) {
        const bucket = hourly.get(h)!;
        bucket.calls++;
        bucket.totalTokens += r.totalTokens;
        bucket.tools.add(r.toolName);
      }
    }

    return [...hourly.entries()].map(([hour, data]) => ({
      hour,
      callVolume: data.calls,
      avgTokens: data.calls > 0 ? Math.round(data.totalTokens / data.calls) : 0,
      toolDiversity: data.tools.size,
    }));
  }

  /**
   * Server relationship analysis: discovers inter-server call patterns.
   */
  analyzeServerRelationships(snapshot: GovernanceSnapshot): Map<string, string[]> {
    const relationships = new Map<string, string[]>();
    const sorted = [...snapshot.callRecords].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      // If calls within 5 seconds of each other from different servers
      const timeDiff = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
      if (timeDiff < 5000 && prev.serverName !== curr.serverName) {
        const key = prev.serverName;
        if (!relationships.has(key)) relationships.set(key, []);
        if (!relationships.get(key)!.includes(curr.serverName)) {
          relationships.get(key)!.push(curr.serverName);
        }
      }
    }

    return relationships;
  }

  /**
   * Correlate package CVE posture with upstream API errors / auth flips for VDE.
   */
  correlateVulnStackSignals(input: {
    packageCves: Array<{ packageName: string; cveId?: string; serverName: string }>;
    upstreamEvents: Array<{
      url: string;
      statusFrom?: number;
      statusTo?: number;
      errorRate?: number;
      relatedServer?: string;
    }>;
    toolWatchAdds?: Array<{ serverName: string; toolName: string }>;
  }): CrossLayerInsight[] {
    const insights: CrossLayerInsight[] = [];
    for (const cve of input.packageCves) {
      const related = input.upstreamEvents.filter(
        (u) =>
          u.relatedServer === cve.serverName ||
          (u.errorRate != null && u.errorRate > 0.2),
      );
      if (related.length) {
        insights.push({
          type: 'cve-upstream-correlation',
          severity: 'critical',
          description: `Package ${cve.packageName} (${cve.cveId || 'pre-advisory'}) on ${cve.serverName} coincides with upstream instability (${related.map((r) => r.url).slice(0, 3).join(', ')}).`,
          correlatedLayers: ['security', 'health'],
          confidence: 0.75,
        });
      }
    }
    for (const add of input.toolWatchAdds || []) {
      const authFlip = input.upstreamEvents.find(
        (u) =>
          u.relatedServer === add.serverName &&
          u.statusFrom === 401 &&
          u.statusTo === 200,
      );
      if (authFlip) {
        insights.push({
          type: 'toolwatch-auth-bypass-candidate',
          severity: 'critical',
          description: `New tool ${add.toolName} on ${add.serverName} coincides with upstream ${authFlip.url} flipping 401→200 — possible auth bypass.`,
          correlatedLayers: ['security', 'health'],
          confidence: 0.8,
        });
      }
    }
    return insights;
  }
}

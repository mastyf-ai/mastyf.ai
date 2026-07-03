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
  score: number; // 0-100
  weight: number; // 0-1
  details: string;
}

export class RiskScorer {
  /**
   * Score a single MCP server for risk.
   */
  scoreServer(server: McpServerConfig, knownCves: number = 0, maxCvssScore: number = 0): RiskScore {
    const factors: RiskFactor[] = [];

    // Factor 1: CVE impact
    const cveScore = Math.min(maxCvssScore * 10, 100); // CVSS max 10 → 0-100
    factors.push({
      name: 'CVE Exposure',
      score: cveScore,
      weight: 0.30,
      details: `${knownCves} known CVEs, max CVSS ${maxCvssScore.toFixed(1)}`,
    });

    // Factor 2: Tool capability risk
    const capabilityScore = this.scoreCapability(server);
    factors.push({
      name: 'Tool Capability Risk',
      score: capabilityScore,
      weight: 0.25,
      details: `Based on tool names/descriptions`,
    });

    // Factor 3: Network exposure
    const exposureScore = this.scoreExposure(server);
    factors.push({
      name: 'Network Exposure',
      score: exposureScore,
      weight: 0.20,
      details: this.getExposureDetails(server),
    });

    // Factor 4: Release velocity (only when real package metadata is available)
    const velocityScore = this.scoreVelocity(server);
    factors.push({
      name: 'Release Velocity',
      score: velocityScore ?? 0,
      weight: velocityScore === null ? 0 : 0.10,
      details: velocityScore === null
        ? 'Unavailable - package registry release cadence was not measured'
        : velocityScore > 50 ? 'Frequent releases increase surface area' : 'Stable release cadence',
    });

    // Factor 5: Authentication posture
    const authScore = this.scoreAuth(server);
    factors.push({
      name: 'Authentication Posture',
      score: authScore,
      weight: 0.15,
      details: authScore > 50 ? 'Weak or missing authentication' : 'Strong authentication configured',
    });

    // Compute weighted overall score
    const overallScore = factors.reduce((sum, f) => sum + f.score * f.weight, 0);

    // Determine tier
    const tier = this.determineTier(overallScore);

    // Predicted time-to-exploit (heuristic)
    const predictedTte = this.estimateTte(overallScore, knownCves);

    // Recommendation
    const recommendation = this.generateRecommendation(tier, factors);

    return {
      serverName: server.name,
      overallScore: Math.round(overallScore),
      factors,
      tier,
      predictedTte,
      recommendation,
    };
  }

  /**
   * Score based on tool capability risk.
   * Tools that can write, execute, or delete are high-risk.
   */
  private scoreCapability(server: McpServerConfig): number {
    const highRiskPatterns = [
      /execute/i, /exec/i, /shell/i, /bash/i, /run/i,
      /write/i, /delete/i, /remove/i, /drop/i, /truncate/i,
      /deploy/i, /sudo/i, /admin/i, /root/i,
      /sql/i, /query/i, /migrate/i,
      /token/i, /secret/i, /credential/i,
    ];

    const mediumRiskPatterns = [
      /send/i, /post/i, /create/i, /update/i, /modify/i,
      /upload/i, /download/i, /transfer/i,
      /config/i, /setting/i, /policy/i,
    ];

    // Check package name and command args for risk indicators
    const pkgName = server.packageName || '';
    const command = server.command || '';
    const args = (server.args || []).join(' ');
    const searchText = `${pkgName} ${command} ${args}`;

    let highRiskCount = 0;
    let mediumRiskCount = 0;

    if (highRiskPatterns.some(p => p.test(searchText))) {
      highRiskCount++;
    }
    if (mediumRiskPatterns.some(p => p.test(searchText))) {
      mediumRiskCount++;
    }

    const baseScore = 20;
    const highScore = Math.min(highRiskCount * 25, 60);
    const mediumScore = Math.min(mediumRiskCount * 10, 20);

    return Math.min(baseScore + highScore + mediumScore, 100);
  }

  /**
   * Score based on network exposure.
   */
  private scoreExposure(server: McpServerConfig): number {
    const transport = (server.transport || '').toLowerCase();

    if (transport.includes('http') || transport.includes('sse') || transport.includes('ws')) {
      return 70; // Remote-accessible — higher risk
    }
    if (transport.includes('stdio')) {
      return 15; // Local only — low risk
    }
    return 40; // Unknown — moderate risk
  }

  private getExposureDetails(server: McpServerConfig): string {
    const transport = (server.transport || 'unknown').toLowerCase();
    switch (true) {
      case transport.includes('http'): return 'HTTP endpoint — remotely accessible';
      case transport.includes('sse'): return 'SSE endpoint — remotely accessible';
      case transport.includes('ws'): return 'WebSocket — remotely accessible';
      case transport.includes('stdio'): return 'stdio — local process only';
      default: return `Unknown transport: ${transport}`;
    }
  }

  /** Score based on release velocity when package registry metadata has been measured. */
  private scoreVelocity(server: McpServerConfig): number | null {
    const releaseVelocity = (server as McpServerConfig & { releaseVelocityScore?: number }).releaseVelocityScore;
    return Number.isFinite(releaseVelocity) ? Math.max(0, Math.min(100, Number(releaseVelocity))) : null;
  }

  /**
   * Score based on authentication posture.
   */
  private scoreAuth(server: McpServerConfig): number {
    const env = (server.env || {}) as Record<string, string>;
    const envStr = JSON.stringify(env).toLowerCase();

    let score = 60; // Default: assume no auth

    // Check for API key
    if (envStr.includes('api_key') || envStr.includes('apikey') || envStr.includes('token')) {
      score -= 30;
    }

    // Check for OAuth
    if (envStr.includes('oauth') || envStr.includes('oidc') || envStr.includes('client_id')) {
      score -= 15;
    }

    // Check for mTLS
    if (envStr.includes('mtls') || envStr.includes('client_cert') || envStr.includes('tls')) {
      score -= 15;
    }

    return Math.max(score, 0);
  }

  /**
   * Determine risk tier from overall score.
   */
  private determineTier(score: number): RiskScore['tier'] {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    if (score >= 10) return 'low';
    return 'minimal';
  }

  /**
   * Estimate time-to-exploit in days.
   */
  private estimateTte(score: number, knownCves: number): number {
    if (knownCves >= 5 && score > 70) return 1; // Days
    if (knownCves >= 2 && score > 50) return 7;
    if (knownCves >= 1 && score > 30) return 30;
    if (score > 20) return 90;
    return 365; // Low risk — ~1 year
  }

  /**
   * Generate a human-readable recommendation.
   */
  private generateRecommendation(tier: RiskScore['tier'], factors: RiskFactor[]): string {
    switch (tier) {
      case 'critical':
        return 'IMMEDIATE ACTION: Disable this server until CVEs are patched and authentication is hardened. Add strict argument allowlist and enable semantic guard.';
      case 'high':
        return 'URGENT: Apply CVE patches immediately. Add rate limiting and audit all tool calls. Consider restricting to read-only mode.';
      case 'medium':
        return 'Review CVE status. Enable authentication if not already present. Monitor for anomalous usage patterns.';
      case 'low':
        return 'Maintain current security posture. Review dependency updates monthly.';
      case 'minimal':
        return 'Low risk — continue standard monitoring.';
    }
  }

  /**
   * Compare two servers and return relative risk ranking.
   */
  compare(a: RiskScore, b: RiskScore): number {
    return b.overallScore - a.overallScore;
  }
}
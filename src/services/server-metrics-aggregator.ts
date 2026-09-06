/**
 * Server Metrics Aggregator
 *
 * Maintains in-memory and database-backed state for each individual MCP server,
 * providing isolated traffic views, tool risk classifications, and threat history.
 */

import { calculateServerThreatScore, type ServerThreatScoreResult } from './server-threat-scorer.js';

export type ToolRiskTier = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface ServerToolMeta {
  name: string;
  serverName: string;
  riskTier: ToolRiskTier;
  totalCalls: number;
  blockedCalls: number;
  lastUsed: string;
}

export interface ServerThreatEvent {
  timestamp: string;
  serverName: string;
  toolName: string;
  rule: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  argumentsSnippet: string;
}

export interface IndividualServerSummary {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'offline';
  transport: 'stdio' | 'http' | 'sse' | 'ws';
  threatScore: ServerThreatScoreResult;
  totalCalls: number;
  blockedCalls: number;
  allowedCalls: number;
  flaggedCalls: number;
  toolCount: number;
  highRiskToolCount: number;
  recentThreats: ServerThreatEvent[];
  tools: ServerToolMeta[];
}

const HIGH_RISK_TOOL_PATTERNS = [
  /(?:execute|run|shell|bash|sh|cmd|powershell|exec|eval)/i,
  /(?:write|delete|remove|rm|drop|truncate|push|clone)/i,
  /(?:query|sql|mutation|graphql)/i,
];

const CRITICAL_TOOL_PATTERNS = [
  /(?:delete_repo|drop_table|truncate|rm_rf|format)/i,
];

export function classifyToolRisk(toolName: string): ToolRiskTier {
  for (const pattern of CRITICAL_TOOL_PATTERNS) {
    if (pattern.test(toolName)) return 'critical';
  }
  for (const pattern of HIGH_RISK_TOOL_PATTERNS) {
    if (pattern.test(toolName)) return 'high';
  }
  if (/(?:create|update|insert|modify|post|put)/i.test(toolName)) {
    return 'medium';
  }
  if (/(?:read|get|list|search|view|inspect|echo)/i.test(toolName)) {
    return 'safe';
  }
  return 'low';
}

export class ServerMetricsAggregator {
  private servers = new Map<string, {
    totalCalls: number;
    blockedCalls: number;
    allowedCalls: number;
    flaggedCalls: number;
    transport: 'stdio' | 'http' | 'sse' | 'ws';
    tools: Map<string, ServerToolMeta>;
    threats: ServerThreatEvent[];
  }>();

  public recordCall(params: {
    serverName: string;
    toolName: string;
    decision: 'allow' | 'block' | 'flag';
    rule?: string;
    reason?: string;
    args?: Record<string, unknown>;
    transport?: 'stdio' | 'http' | 'sse' | 'ws';
  }): void {
    const { serverName, toolName, decision, rule, reason, args, transport = 'stdio' } = params;
    const now = new Date().toISOString();

    if (!this.servers.has(serverName)) {
      this.servers.set(serverName, {
        totalCalls: 0,
        blockedCalls: 0,
        allowedCalls: 0,
        flaggedCalls: 0,
        transport,
        tools: new Map(),
        threats: [],
      });
    }

    const serverData = this.servers.get(serverName)!;
    serverData.totalCalls++;

    if (decision === 'block') {
      serverData.blockedCalls++;
      const isCritical =
        (rule && (rule.includes('injection') || rule.includes('exfil') || rule.includes('reverse-shell'))) || false;

      serverData.threats.unshift({
        timestamp: now,
        serverName,
        toolName,
        rule: rule || 'policy-block',
        reason: reason || 'Blocked by policy',
        severity: isCritical ? 'critical' : 'high',
        argumentsSnippet: JSON.stringify(args || {}).slice(0, 150),
      });

      // Keep last 50 threats per server
      if (serverData.threats.length > 50) {
        serverData.threats.pop();
      }
    } else if (decision === 'flag') {
      serverData.flaggedCalls++;
    } else {
      serverData.allowedCalls++;
    }

    // Update tool metadata
    if (!serverData.tools.has(toolName)) {
      serverData.tools.set(toolName, {
        name: toolName,
        serverName,
        riskTier: classifyToolRisk(toolName),
        totalCalls: 0,
        blockedCalls: 0,
        lastUsed: now,
      });
    }

    const toolMeta = serverData.tools.get(toolName)!;
    toolMeta.totalCalls++;
    if (decision === 'block') toolMeta.blockedCalls++;
    toolMeta.lastUsed = now;
  }

  public getServerSummary(serverName: string): IndividualServerSummary | null {
    const data = this.servers.get(serverName);
    if (!data) return null;

    const tools = Array.from(data.tools.values());
    const highRiskToolCount = tools.filter(
      (t) => t.riskTier === 'high' || t.riskTier === 'critical',
    ).length;

    const oneHourAgo = Date.now() - 3600000;
    const recentThreats1h = data.threats.filter(
      (t) => new Date(t.timestamp).getTime() >= oneHourAgo,
    ).length;

    const criticalThreatCount = data.threats.filter(
      (t) => t.severity === 'critical',
    ).length;

    const threatScore = calculateServerThreatScore({
      serverName,
      totalCalls: data.totalCalls,
      blockedCalls: data.blockedCalls,
      criticalThreatCount,
      highRiskToolCount,
      recentThreats1h,
    });

    let status: 'healthy' | 'degraded' | 'unhealthy' | 'offline' = 'healthy';
    if (threatScore.tier === 'danger') status = 'unhealthy';
    else if (threatScore.tier === 'warning') status = 'degraded';

    return {
      name: serverName,
      status,
      transport: data.transport,
      threatScore,
      totalCalls: data.totalCalls,
      blockedCalls: data.blockedCalls,
      allowedCalls: data.allowedCalls,
      flaggedCalls: data.flaggedCalls,
      toolCount: tools.length,
      highRiskToolCount,
      recentThreats: data.threats.slice(0, 10),
      tools,
    };
  }

  public getAllServers(): IndividualServerSummary[] {
    return Array.from(this.servers.keys())
      .map((name) => this.getServerSummary(name))
      .filter((s): s is IndividualServerSummary => s !== null);
  }
}

export const globalServerMetricsAggregator = new ServerMetricsAggregator();

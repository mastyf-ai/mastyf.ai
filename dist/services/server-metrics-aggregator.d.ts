/**
 * Server Metrics Aggregator
 *
 * Maintains in-memory and database-backed state for each individual MCP server,
 * providing isolated traffic views, tool risk classifications, and threat history.
 */
import { type ServerThreatScoreResult } from './server-threat-scorer.js';
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
export declare function classifyToolRisk(toolName: string): ToolRiskTier;
export declare class ServerMetricsAggregator {
    private servers;
    recordCall(params: {
        serverName: string;
        toolName: string;
        decision: 'allow' | 'block' | 'flag';
        rule?: string;
        reason?: string;
        args?: Record<string, unknown>;
        transport?: 'stdio' | 'http' | 'sse' | 'ws';
    }): void;
    getServerSummary(serverName: string): IndividualServerSummary | null;
    getAllServers(): IndividualServerSummary[];
}
export declare const globalServerMetricsAggregator: ServerMetricsAggregator;
//# sourceMappingURL=server-metrics-aggregator.d.ts.map
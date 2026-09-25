/**
 * MCP server health report — measured facts + optional Ollama plain-language narrative.
 */
import type { IDatabase } from '../database/database-interface.js';
export type McpHealthVerdict = 'healthy' | 'attention' | 'critical';
export type ServerHealthSection = {
    name: string;
    latencyMs: number | null;
    successRatePct: number | null;
    toolCount: number;
    circuitBreaker: string;
    totalCalls: number;
    blockedCalls: number;
    summary: string;
};
export type McpHealthReport = {
    generatedAt: string;
    windowDays: number;
    verdict: McpHealthVerdict;
    headline: string;
    executiveSummary: string[];
    servers: ServerHealthSection[];
    performance: {
        avgLatencyMs: number | null;
        passRatePct: number;
        totalRequests: number;
        blockedRequests: number;
        totalCostUsd: number;
    };
    securityPosture: {
        policyMode: string;
        ruleSummary: string;
        topBlockRules: string[];
    };
    recommendations: Array<{
        priority: number;
        action: string;
    }>;
    markdown: string;
    citations: Array<{
        id: string;
        source: string;
        text: string;
    }>;
    source: 'measured' | 'llm';
    provider?: string;
    model?: string;
    narrative?: string;
};
export declare function buildMcpHealthReport(db: IDatabase | null, tenantId: string | undefined, opts?: {
    windowDays?: number;
    useLlm?: boolean;
}): Promise<McpHealthReport | null>;
//# sourceMappingURL=mcp-health-report.d.ts.map
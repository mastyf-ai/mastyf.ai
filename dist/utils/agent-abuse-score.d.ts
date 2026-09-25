/**
 * Agent Abuse Score — unified security + cost misbehavior metric per session/agent.
 */
import type { ProxyCallRecord } from '../types.js';
import type { StoredSemanticAudit } from '../ai/semantic-audit-store.js';
export type AbuseFactor = {
    name: string;
    weight: number;
    raw: number;
    contribution: number;
    detail: string;
};
export type AgentAbuseScore = {
    sessionKey: string;
    agentId: string;
    serverName: string;
    score: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    factors: AbuseFactor[];
    callCount: number;
    blockedCount: number;
    semanticFlags: number;
    totalCostUsd: number;
    summary: string;
};
export declare function computeAgentAbuseScore(sessionKeyStr: string, records: ProxyCallRecord[], semanticRecords: StoredSemanticAudit[]): AgentAbuseScore;
export declare function computeAgentAbuseScores(records: ProxyCallRecord[], semanticRecords: StoredSemanticAudit[], opts?: {
    limit?: number;
}): AgentAbuseScore[];
//# sourceMappingURL=agent-abuse-score.d.ts.map
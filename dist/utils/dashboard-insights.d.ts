/**
 * Dashboard insights for enterprise panels — measured by default; opt-in LLM with strict RAG citations.
 */
import type { IDatabase } from '../database/database-interface.js';
import { type ExecutiveSummary } from './dashboard-executive-summary.js';
export type InsightScope = 'overview' | 'cost' | 'security' | 'audit' | 'ai';
export type InsightCitation = {
    id: string;
    text: string;
};
export type DashboardInsightsPayload = {
    scope: InsightScope;
    generatedAt: string;
    windowDays?: number;
    source: 'measured' | 'llm' | 'deterministic';
    provider?: string;
    model?: string;
    bullets: string[];
    narrative?: string;
    citations?: InsightCitation[];
};
export declare function buildDashboardInsights(db: IDatabase, tenantId: string | undefined, scope: InsightScope, opts?: {
    windowDays?: number;
    securityScore?: number | null;
    activeThreats?: number;
    auditBlocked?: number;
    auditTotal?: number;
}): Promise<DashboardInsightsPayload>;
/** Markdown briefing for compliance export (PDF via browser print or attachment download). */
export declare function formatInsightsBriefingMarkdown(payload: DashboardInsightsPayload): string;
export declare function buildDeterministicInsightsOnly(scope: InsightScope, summary: ExecutiveSummary, opts?: {
    securityScore?: number | null;
    activeThreats?: number;
    auditBlocked?: number;
    auditTotal?: number;
}): DashboardInsightsPayload;
//# sourceMappingURL=dashboard-insights.d.ts.map
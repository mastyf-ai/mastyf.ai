/**
 * Dashboard insights for enterprise panels — measured by default; opt-in LLM with strict RAG citations.
 */
import type { IDatabase } from '../database/database-interface.js';
import { buildExecutiveSummary, type ExecutiveSummary } from './dashboard-executive-summary.js';
import { buildAuditHeatmap } from './audit-heatmap.js';
import { loadAllRecordsInWindow } from './cost-timeseries.js';
import { isStrictLiveDashboard } from './swarm-session.js';
import { parseWindowDays } from './time-buckets.js';
import { LlmAssistant } from '../ai/llm-assistant.js';
import { Logger } from './logger.js';

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

function measuredOverview(summary: ExecutiveSummary): string[] {
  const bullets: string[] = [];
  bullets.push(
    `${summary.totalRequests.toLocaleString()} measured proxy calls across ${summary.activeServers} server(s)${
      summary.passRatePct != null ? `; pass rate ${summary.passRatePct}%` : ''
    }.`,
  );
  if (summary.budgetUsd != null && summary.budgetUtilizationPct != null) {
    bullets.push(
      `Budget utilization ${summary.budgetUtilizationPct}% of $${summary.budgetUsd.toFixed(2)} daily cap (measured spend only).`,
    );
  }
  if (summary.topToolsByCalls[0]) {
    bullets.push(
      `Highest-volume tool: ${summary.topToolsByCalls[0].tool} (${summary.topToolsByCalls[0].calls} calls).`,
    );
  }
  return bullets.slice(0, 5);
}

function measuredCost(summary: ExecutiveSummary): string[] {
  if (summary.totalCostUsd <= 0) return [];
  const bullets: string[] = [`Total measured spend: $${summary.totalCostUsd.toFixed(4)}.`];
  if (summary.topServersByCost[0]) {
    const top = summary.topServersByCost[0];
    bullets.push(`Top cost driver: ${top.server} ($${top.costUsd.toFixed(4)}, ${top.calls} calls).`);
  }
  if (summary.budgetUsd != null) {
    bullets.push(
      summary.budgetUtilizationPct != null && summary.budgetUtilizationPct >= 100
        ? `Daily budget $${summary.budgetUsd.toFixed(2)} exceeded by measured spend.`
        : `Daily budget cap $${summary.budgetUsd.toFixed(2)} (${summary.budgetUtilizationPct ?? 0}% of measured spend).`,
    );
  }
  return bullets.slice(0, 5);
}

function measuredSecurity(overallScore: number | null, activeThreats: number): string[] {
  const bullets: string[] = [];
  if (overallScore != null) {
    bullets.push(`Measured security posture score: ${overallScore}/100.`);
  }
  if (activeThreats > 0) {
    bullets.push(`${activeThreats} active threat-intel item(s) from live feed.`);
  }
  return bullets.slice(0, 4);
}

function measuredAudit(blocked: number, total: number, heatmapTop: string): string[] {
  if (total === 0) return [];
  const blockPct = Math.round((blocked / total) * 100);
  const bullets = [
    `${total.toLocaleString()} measured audit events; ${blocked.toLocaleString()} blocks (${blockPct}%).`,
  ];
  if (heatmapTop) bullets.push(`Top block pattern: ${heatmapTop}.`);
  return bullets.slice(0, 4);
}

function measuredBullets(
  scope: InsightScope,
  summary: ExecutiveSummary,
  securityScore: number | null,
  activeThreats: number,
  auditBlocked: number,
  auditTotal: number,
  heatmapTop?: { rule: string; tool: string; count: number },
): string[] {
  switch (scope) {
    case 'cost':
      return measuredCost(summary);
    case 'security':
      return measuredSecurity(securityScore, activeThreats);
    case 'audit':
      return measuredAudit(
        auditBlocked,
        auditTotal,
        heatmapTop ? `${heatmapTop.rule} on ${heatmapTop.tool} (${heatmapTop.count}×)` : '',
      );
    case 'ai':
      if (summary.blockedRequests <= 0) return [];
      return [
        `${summary.blockedRequests} measured blocks recorded — review pending suggestions and semantic labels.`,
      ];
    case 'overview':
    default:
      return summary.totalRequests > 0 ? measuredOverview(summary) : [];
  }
}

function hasMeasuredDataForScope(
  scope: InsightScope,
  summary: ExecutiveSummary,
  securityScore: number | null,
  activeThreats: number,
  auditBlocked: number,
  auditTotal: number,
): boolean {
  switch (scope) {
    case 'cost':
      return summary.totalCostUsd > 0;
    case 'security':
      return securityScore != null || activeThreats > 0;
    case 'audit':
      return auditTotal > 0;
    case 'ai':
      return summary.blockedRequests > 0;
    case 'overview':
    default:
      return summary.totalRequests > 0;
  }
}

function isInsightsLlmEnabled(): boolean {
  return process.env.GUARDIAN_INSIGHTS_LLM === 'true';
}

function buildRagCorpus(
  scope: InsightScope,
  summary: ExecutiveSummary,
  bullets: string[],
  heatmapTop?: { rule: string; tool: string; count: number },
): InsightCitation[] {
  const citations: InsightCitation[] = [];
  citations.push({
    id: 'exec:totalRequests',
    text: `${summary.totalRequests} total proxy calls (${summary.passRatePct}% pass rate)`,
  });
  if (summary.totalCostUsd > 0) {
    citations.push({
      id: 'exec:totalCostUsd',
      text: `$${summary.totalCostUsd.toFixed(4)} measured spend`,
    });
  }
  if (summary.blockedRequests > 0) {
    citations.push({
      id: 'exec:blockedRequests',
      text: `${summary.blockedRequests} blocked requests`,
    });
  }
  if (heatmapTop) {
    citations.push({
      id: 'audit:heatmapTop',
      text: `Top block: ${heatmapTop.rule} on ${heatmapTop.tool} (${heatmapTop.count}×)`,
    });
  }
  bullets.forEach((b, i) => {
    citations.push({ id: `bullet:${scope}:${i}`, text: b });
  });
  return citations;
}

function validateLlmCitations(narrative: string, citations: InsightCitation[]): boolean {
  const ids = citations.map((c) => c.id);
  return ids.some((id) => narrative.includes(`[${id}]`) || narrative.includes(id));
}

async function buildLlmNarrative(
  scope: InsightScope,
  citations: InsightCitation[],
): Promise<{ narrative: string; provider: string; model: string } | null> {
  const llm = new LlmAssistant({ hotPath: false });
  if (!llm.isAvailable()) return null;
  const healthy = await llm.healthCheck();
  if (!healthy) return null;

  const corpus = citations.map((c) => `[${c.id}] ${c.text}`).join('\n');
  const result = await llm.generate(
    `You write board-ready MCP security briefings. Use ONLY the cited facts below. Every sentence must include at least one citation ID in brackets like [exec:totalRequests]. No invented statistics.`,
    `Scope: ${scope}\n\nFacts:\n${corpus}\n\nWrite 2-3 sentences for executives:`,
  );
  if (!result?.text) return null;
  if (!validateLlmCitations(result.text, citations)) {
    Logger.debug('[dashboard-insights] LLM narrative rejected — missing citation IDs');
    return null;
  }
  return { narrative: result.text, provider: 'ollama', model: result.model };
}

export async function buildDashboardInsights(
  db: IDatabase,
  tenantId: string | undefined,
  scope: InsightScope,
  opts?: {
    windowDays?: number;
    securityScore?: number | null;
    activeThreats?: number;
    auditBlocked?: number;
    auditTotal?: number;
  },
): Promise<DashboardInsightsPayload> {
  const windowDays = parseWindowDays(opts?.windowDays ?? 7);
  const securityScore = opts?.securityScore ?? null;
  const activeThreats = opts?.activeThreats ?? 0;
  const auditBlocked = opts?.auditBlocked ?? 0;
  const auditTotal = opts?.auditTotal ?? 0;

  const summary = await buildExecutiveSummary(db, tenantId, windowDays);
  const records = await loadAllRecordsInWindow(db, tenantId, windowDays);
  const heatmap = buildAuditHeatmap(records, 5);
  const heatmapTop = heatmap[0];

  const bullets = measuredBullets(
    scope,
    summary,
    securityScore,
    activeThreats,
    auditBlocked,
    auditTotal,
    heatmapTop,
  );

  const emptyPayload: DashboardInsightsPayload = {
    scope,
    generatedAt: new Date().toISOString(),
    windowDays,
    source: 'measured',
    bullets: [],
  };

  const ragCitations = buildRagCorpus(scope, summary, bullets, heatmapTop);

  if (isInsightsLlmEnabled() && bullets.length > 0) {
    const llmResult = await buildLlmNarrative(scope, ragCitations);
    if (llmResult) {
      return {
        scope,
        generatedAt: new Date().toISOString(),
        windowDays,
        source: 'llm',
        provider: llmResult.provider,
        model: llmResult.model,
        bullets,
        narrative: llmResult.narrative,
        citations: ragCitations,
      };
    }
  }

  if (isStrictLiveDashboard()) {
    if (!hasMeasuredDataForScope(scope, summary, securityScore, activeThreats, auditBlocked, auditTotal)) {
      return emptyPayload;
    }
    return {
      scope,
      generatedAt: new Date().toISOString(),
      windowDays,
      source: 'measured',
      bullets,
      citations: ragCitations.length ? ragCitations : undefined,
    };
  }

  return {
    scope,
    generatedAt: new Date().toISOString(),
    windowDays,
    source: 'deterministic',
    bullets: bullets.length ? bullets : ['No measured proxy traffic yet.'],
    citations: ragCitations.length ? ragCitations : undefined,
  };
}

/** Markdown briefing for compliance export (PDF via browser print or attachment download). */
export function formatInsightsBriefingMarkdown(payload: DashboardInsightsPayload): string {
  const lines: string[] = [
    '# MCP Guardian Executive Briefing',
    '',
    `- **Scope:** ${payload.scope}`,
    `- **Generated:** ${payload.generatedAt}`,
    `- **Source:** ${payload.source}${payload.model ? ` (${payload.model})` : ''}`,
  ];
  if (payload.windowDays != null) lines.push(`- **Window:** ${payload.windowDays} days`);
  lines.push('');

  if (payload.narrative) {
    lines.push('## Narrative', '', payload.narrative, '');
  }

  if (payload.bullets.length) {
    lines.push('## Key metrics', '');
    for (const b of payload.bullets) lines.push(`- ${b}`);
    lines.push('');
  }

  if (payload.citations?.length) {
    lines.push('## Citations (RAG corpus)', '');
    for (const c of payload.citations) lines.push(`- [${c.id}] ${c.text}`);
    lines.push('');
  }

  lines.push('---', '_Generated by MCP Guardian — measured aggregates only._');
  return lines.join('\n');
}

export function buildDeterministicInsightsOnly(
  scope: InsightScope,
  summary: ExecutiveSummary,
  opts?: { securityScore?: number | null; activeThreats?: number; auditBlocked?: number; auditTotal?: number },
): DashboardInsightsPayload {
  const securityScore = opts?.securityScore ?? null;
  const activeThreats = opts?.activeThreats ?? 0;
  const auditBlocked = opts?.auditBlocked ?? 0;
  const auditTotal = opts?.auditTotal ?? 0;

  return {
    scope,
    generatedAt: new Date().toISOString(),
    source: isStrictLiveDashboard() ? 'measured' : 'deterministic',
    bullets: measuredBullets(scope, summary, securityScore, activeThreats, auditBlocked, auditTotal),
  };
}

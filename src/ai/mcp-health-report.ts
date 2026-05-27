/**
 * MCP server health report — measured facts + optional Ollama plain-language narrative.
 */
import type { IDatabase } from '../database/database-interface.js';
import { buildExecutiveSummary } from '../utils/dashboard-executive-summary.js';
import { getAllActiveServerNames } from '../utils/db-aggregate.js';
import { fetchCircuitBreakerStates } from '../utils/tui-sources.js';
import { readSwarmJsonFile } from '../utils/swarm-artifacts.js';
import {
  filterRecordsInWindow,
  parseWindowDays,
  windowRangeMs,
  windowToLabel,
} from '../utils/time-buckets.js';
import { LlmAssistant } from './llm-assistant.js';
import { Logger } from '../utils/logger.js';
import { existsSync, readFileSync } from 'fs';
import { load } from 'js-yaml';

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
  recommendations: Array<{ priority: number; action: string }>;
  markdown: string;
  citations: Array<{ id: string; source: string; text: string }>;
  source: 'measured' | 'llm';
  provider?: string;
  model?: string;
  narrative?: string;
};

function isHealthReportLlmEnabled(useLlm: boolean): boolean {
  return useLlm && (process.env.GUARDIAN_HEALTH_REPORT_LLM === 'true' || process.env.GUARDIAN_INSIGHTS_LLM === 'true');
}

function defaultPolicyPath(): string {
  return process.env.GUARDIAN_POLICY_PATH || process.env.MCP_GUARDIAN_POLICY_PATH || 'default-policy.yaml';
}

async function loadPolicySnapshot(): Promise<{ mode: string; ruleSummary: string }> {
  const path = defaultPolicyPath();
  if (!existsSync(path)) {
    return { mode: 'unknown', ruleSummary: 'No policy file on disk' };
  }
  try {
    const yaml = readFileSync(path, 'utf-8');
    const doc = load(yaml) as { policy?: { mode?: string; rules?: unknown[] } };
    const mode = doc?.policy?.mode || 'audit';
    const rules = Array.isArray(doc?.policy?.rules) ? doc.policy.rules.length : 0;
    return { mode, ruleSummary: `${rules} active rule(s)` };
  } catch {
    return { mode: 'unknown', ruleSummary: 'Policy file unreadable' };
  }
}

function windowLabelForSummary(windowDays: number): string {
  const label = windowToLabel(windowDays);
  if (label === '1h') return 'last 1 hour';
  if (label === '12h') return 'last 12 hours';
  if (label === '24h') return 'last 24 hours';
  if (label === '7d') return 'last 7 days';
  if (label === '30d') return 'last 30 days';
  return 'last 90 days';
}

async function buildServerSections(
  db: IDatabase,
  tenantId: string | undefined,
  windowDays: number,
): Promise<{ servers: ServerHealthSection[]; avgLatency: number | null; atRisk: string[] }> {
  const { startMs, endMs } = windowRangeMs(windowDays);
  const windowLabel = windowLabelForSummary(windowDays);
  const srvs = await getAllActiveServerNames(db, tenantId);
  const cbStates = await fetchCircuitBreakerStates();
  const reps: ServerHealthSection[] = [];
  let latSum = 0;
  let latCount = 0;
  const atRisk: string[] = [];

  for (const srv of srvs) {
    const allRecs = await db.getCallRecordsForServer(srv, undefined, tenantId);
    const recs = filterRecordsInWindow(allRecs, startMs, endMs);
    const callLat =
      recs.length > 0
        ? Math.round(recs.reduce((s, r) => s + (r.durationMs || 0), 0) / recs.length)
        : 0;
    const sr = await db.getRecentSuccessRate(srv, tenantId);
    let latency = callLat;
    let tools = 0;
    if (typeof db.getLatestHealthCheck === 'function') {
      const hc = await db.getLatestHealthCheck(srv, tenantId);
      if (hc) {
        latency = (hc as { latency_ms?: number; latencyMs?: number }).latency_ms
          ?? (hc as { latencyMs?: number }).latencyMs
          ?? callLat;
        tools = (hc as { tool_count?: number; toolCount?: number }).tool_count
          ?? (hc as { toolCount?: number }).toolCount
          ?? 0;
      }
    }
    const blocked = recs.filter((r) => r.blocked).length;
    const successPct = sr != null ? Math.round(sr * 100) : null;
    if (latency > 0) {
      latSum += latency;
      latCount++;
    }
    if ((latency > 200) || (successPct != null && successPct < 70)) {
      atRisk.push(srv);
    }
    const cb = cbStates.get(srv) ?? 'closed';
    let summary = `${recs.length} calls in ${windowLabel}`;
    if (successPct != null) summary += `; ${successPct}% success`;
    if (blocked > 0) summary += `; ${blocked} blocked`;
    reps.push({
      name: srv,
      latencyMs: latency > 0 ? latency : null,
      successRatePct: successPct,
      toolCount: tools,
      circuitBreaker: cb,
      totalCalls: recs.length,
      blockedCalls: blocked,
      summary,
    });
  }

  const avgLatency = latCount > 0 ? Math.round(latSum / latCount) : null;
  return { servers: reps, avgLatency, atRisk };
}

async function topBlockRuleLabels(
  db: IDatabase,
  tenantId: string | undefined,
): Promise<string[]> {
  const srvs = await getAllActiveServerNames(db, tenantId);
  const counts = new Map<string, number>();
  for (const srv of srvs) {
    const recs = await db.getCallRecordsForServer(srv, undefined, tenantId);
    for (const r of recs) {
      if (!r.blocked) continue;
      const label = r.blockRule?.trim() || r.toolName || 'unknown';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule, n]) => `${rule} (${n})`);
}

function computeVerdict(
  atRisk: string[],
  blocked: number,
  total: number,
): McpHealthVerdict {
  if (atRisk.length >= 2 || (total > 0 && blocked / total > 0.5)) return 'critical';
  if (atRisk.length > 0 || blocked > 0) return 'attention';
  return 'healthy';
}

function formatMarkdown(report: Omit<McpHealthReport, 'markdown'> & { narrative?: string }): string {
  const lines: string[] = [
    '# MCP Guardian — Server Health Report',
    '',
    `**Generated:** ${report.generatedAt}`,
    `**Window:** ${report.windowDays} day(s)`,
    `**Overall:** ${report.verdict.toUpperCase()} — ${report.headline}`,
    '',
  ];

  if (report.narrative) {
    lines.push('## Summary in plain language', '', report.narrative, '');
  }

  lines.push('## Executive summary', '');
  for (const b of report.executiveSummary) lines.push(`- ${b}`);
  lines.push('');

  lines.push('## Your MCP servers', '');
  if (!report.servers.length) {
    lines.push('_No server traffic recorded in this window yet._', '');
  } else {
    for (const s of report.servers) {
      lines.push(`### ${s.name}`, '');
      lines.push(`- ${s.summary}`);
      lines.push(`- Latency: ${s.latencyMs != null ? `${s.latencyMs}ms` : '—'}`);
      lines.push(`- Success rate: ${s.successRatePct != null ? `${s.successRatePct}%` : '—'}`);
      lines.push(`- Tools registered: ${s.toolCount}`);
      lines.push(`- Circuit breaker: ${s.circuitBreaker}`);
      lines.push('');
    }
  }

  lines.push('## Performance', '');
  lines.push(`- Total requests: ${report.performance.totalRequests.toLocaleString()}`);
  lines.push(`- Blocked: ${report.performance.blockedRequests.toLocaleString()} (${report.performance.passRatePct}% pass rate)`);
  lines.push(`- Average latency: ${report.performance.avgLatencyMs != null ? `${report.performance.avgLatencyMs}ms` : '—'}`);
  lines.push(`- Tracked cost: $${report.performance.totalCostUsd.toFixed(4)}`, '');

  lines.push('## Security posture', '');
  lines.push(`- Policy mode: **${report.securityPosture.policyMode}**`);
  lines.push(`- Rules: ${report.securityPosture.ruleSummary}`);
  if (report.securityPosture.topBlockRules.length) {
    lines.push('- Top block rules:');
    for (const r of report.securityPosture.topBlockRules) lines.push(`  - ${r}`);
  }
  lines.push('');

  if (report.recommendations.length) {
    lines.push('## Recommended next steps', '');
    for (const r of report.recommendations.sort((a, b) => a.priority - b.priority)) {
      lines.push(`${r.priority}. ${r.action}`);
    }
    lines.push('');
  }

  if (report.citations.length) {
    lines.push('## Data sources', '');
    for (const c of report.citations) lines.push(`- [${c.id}] ${c.text}`);
  }

  return lines.join('\n');
}

async function buildLlmNarrative(
  report: Omit<McpHealthReport, 'markdown' | 'narrative' | 'source' | 'provider' | 'model'>,
): Promise<{ narrative: string; provider: string; model: string } | null> {
  const llm = new LlmAssistant({ hotPath: false });
  if (!llm.isAvailable()) return null;
  const healthy = await llm.healthCheck();
  if (!healthy) return null;

  const corpus = report.citations.map((c) => `[${c.id}] ${c.text}`).join('\n');
  try {
    const result = await llm.generate(
      'You explain MCP (Model Context Protocol) server health to a non-technical operator. Use ONLY the cited facts. Write 3-5 short paragraphs in plain English. Do not invent numbers.',
      `Facts:\n${corpus}\n\nWrite a plain-language health briefing:`,
    );
    if (!result?.text?.trim()) return null;
    return { narrative: result.text.trim(), provider: 'ollama', model: result.model };
  } catch (err) {
    Logger.debug(`[mcp-health-report] LLM skipped: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function buildMcpHealthReport(
  db: IDatabase | null,
  tenantId: string | undefined,
  opts?: { windowDays?: number; useLlm?: boolean },
): Promise<McpHealthReport | null> {
  if (!db) return null;

  const windowDays = parseWindowDays(opts?.windowDays ?? 7);
  const summary = await buildExecutiveSummary(db, tenantId, windowDays);
  const { servers, avgLatency, atRisk } = await buildServerSections(db, tenantId, windowDays);
  const policy = await loadPolicySnapshot();

  const traffic = readSwarmJsonFile<{ servers?: Record<string, { calls?: number; blocked?: number }> }>(
    'traffic-summary.json',
    tenantId,
  );
  const userServers = readSwarmJsonFile<{ servers?: Array<{ name: string; reachable?: boolean }> }>(
    'user-servers-session.json',
    tenantId,
  );

  const executiveSummary: string[] = [];
  if (summary.totalRequests > 0) {
    executiveSummary.push(
      `${summary.totalRequests.toLocaleString()} tool calls through Guardian in the last ${windowDays} days.`,
    );
    executiveSummary.push(
      `${summary.blockedRequests.toLocaleString()} were blocked (${summary.passRatePct}% allowed).`,
    );
  } else {
    executiveSummary.push('No proxy traffic recorded yet — connect an MCP client through Guardian to begin monitoring.');
  }
  if (atRisk.length) {
    executiveSummary.push(`Servers needing attention: ${atRisk.join(', ')}.`);
  }
  if (userServers?.servers?.length) {
    const unreachable = userServers.servers.filter((s) => s.reachable === false).map((s) => s.name);
    if (unreachable.length) {
      executiveSummary.push(`Reachability check failed for: ${unreachable.join(', ')}.`);
    }
  }

  const verdict = computeVerdict(atRisk, summary.blockedRequests, summary.totalRequests);
  const headline =
    verdict === 'healthy'
      ? 'Your MCP servers look healthy for this window.'
      : verdict === 'attention'
        ? 'Some servers need a closer look.'
        : 'Critical issues detected — review blocked traffic and server health.';

  const recommendations: Array<{ priority: number; action: string }> = [];
  if (summary.totalRequests === 0) {
    recommendations.push({
      priority: 1,
      action: 'Run the proxy with DASHBOARD_ENABLED=true and send tool calls through Guardian.',
    });
  }
  if (atRisk.length) {
    recommendations.push({
      priority: 2,
      action: `Inspect latency and success rate for: ${atRisk.join(', ')}.`,
    });
  }
  if (summary.blockedRequests > 0) {
    recommendations.push({
      priority: 3,
      action: 'Review Live audit for blocked tools and tune policy if needed.',
    });
  }
  if (traffic?.servers && Object.keys(traffic.servers).length) {
    recommendations.push({
      priority: 4,
      action: 'Compare traffic-summary.json in Security swarm artifacts for regression trends.',
    });
  }

  const citations: Array<{ id: string; source: string; text: string }> = [
    { id: 'exec:requests', source: 'history.db', text: `${summary.totalRequests} total requests` },
    { id: 'exec:blocked', source: 'history.db', text: `${summary.blockedRequests} blocked` },
    { id: 'policy:mode', source: 'policy', text: `Policy mode ${policy.mode}, ${policy.ruleSummary}` },
  ];
  for (const s of servers.slice(0, 8)) {
    citations.push({
      id: `srv:${s.name}`,
      source: 'health',
      text: `${s.name}: ${s.summary}`,
    });
  }

  const base: Omit<McpHealthReport, 'markdown'> = {
    generatedAt: new Date().toISOString(),
    windowDays,
    verdict,
    headline,
    executiveSummary,
    servers,
    performance: {
      avgLatencyMs: avgLatency,
      passRatePct: summary.passRatePct ?? 0,
      totalRequests: summary.totalRequests,
      blockedRequests: summary.blockedRequests,
      totalCostUsd: summary.totalCostUsd,
    },
    securityPosture: {
      policyMode: policy.mode,
      ruleSummary: policy.ruleSummary,
      topBlockRules: await topBlockRuleLabels(db, tenantId),
    },
    recommendations,
    citations,
    source: 'measured',
  };

  if (isHealthReportLlmEnabled(!!opts?.useLlm)) {
    const llm = await buildLlmNarrative(base);
    if (llm) {
      const withLlm = {
        ...base,
        source: 'llm' as const,
        provider: llm.provider,
        model: llm.model,
        narrative: llm.narrative,
      };
      return { ...withLlm, markdown: formatMarkdown(withLlm) };
    }
  }

  return { ...base, markdown: formatMarkdown(base) };
}

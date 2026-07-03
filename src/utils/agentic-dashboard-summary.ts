/**
 * Aggregated agentic dashboard metrics (history DB + in-memory agentic services).
 */
import type { IDatabase } from '../database/database-interface.js';
import type { Container } from '../container.js';
import type { ProxyCallRecord } from '../types.js';
import type { TrustScore } from '../agentic/trust-score/mastyf-ai-score.js';
import type { AgenticDecisionRecord } from '../agentic/telemetry.js';
import { loadAllRecordsInWindow } from './cost-timeseries.js';
import { summarizeRecords } from './db-aggregate.js';
import { getServerRegistry, type ServerRegistryEntry } from './server-registry.js';
import { buildChartMeta, type ChartMetaEnvelope } from './chart-meta.js';
import {
  bucketGranularityForWindow,
  fillTimeSeries,
  generateTimeBuckets,
  parseRecordTimestamp,
  parseWindowDays,
  windowRangeMs,
  windowToLabel,
  type DashboardWindow,
} from './time-buckets.js';

export type AgenticTrafficPoint = {
  bucket: string;
  requests: number;
  blocked: number;
};

export type AgenticServerTrust = {
  name: string;
  transport: string;
  wrapped: boolean;
  metrics?: ServerRegistryEntry['metrics'];
  trust: TrustScore | null;
};

export type AgenticDashboardSummary = {
  available: boolean;
  agenticEnabled: boolean;
  hasProxyHistory: boolean;
  windowDays: number;
  generatedAt: string;
  kpis: {
    uptimeMs: number;
    totalDecisions: number;
    avgConfidence: number;
    llmTokensUsed: number;
    llmCostEstimate: number;
    llmAvailable: boolean;
    blockedRequests: number;
    totalRequests: number;
    injectionDetectionRate: number;
    injectionScans: number;
    meshSignatures: number;
    meshEnabled: boolean;
    decoyActive: number;
    decoyCaptures: number;
    taskQueued: number;
    taskRunning: number;
    complianceOverall: number;
    trustGrade: string;
    trustScore: number;
    activeSessions: number;
  } | null;
  trafficSeries: AgenticTrafficPoint[];
  decisionsByFeature: Record<string, number>;
  recentDecisions: AgenticDecisionRecord[];
  featureHealth: Array<{ name: string; status: string }>;
  servers: AgenticServerTrust[];
  compliance: {
    overall: number;
    frameworks: Array<{
      framework: string;
      frameworkName: string;
      postureScore: number;
      satisfiedControls: number;
      totalControls: number;
    }>;
  };
  policyGen: {
    active: boolean;
    totalCalls: number;
    uniqueTools: number;
    uptimeMin: number;
  };
  decoys: { active: number; totalCaptures: number; recentAlerts: number } | null;
  mesh: { enabled: boolean; localSignatures: number; pendingSignatures: number };
  promptInjectionStats: { totalScans: number; totalDetections: number; detectionRate: number };
  trustSessions: {
    activeSessions: number;
    registeredAgents: number;
    totalNegotiations: number;
  };
  meta: ChartMetaEnvelope;
  emptyReason?: string;
  /** When the selected window is empty but older history exists */
  historyOutsideWindow?: number;
  suggestedWindow?: DashboardWindow;
  windowLabel?: string;
};

function bucketKey(ts: number, granularity: 'hour' | 'day'): string {
  const d = new Date(ts);
  if (granularity === 'hour') return d.toISOString().slice(0, 13) + ':00:00.000Z';
  return d.toISOString().slice(0, 10);
}

function buildTrafficSeries(
  records: ProxyCallRecord[],
  sinceMs: number,
  endMs: number,
  granularity: 'hour' | 'day',
): AgenticTrafficPoint[] {
  const buckets = generateTimeBuckets(sinceMs, endMs, granularity);
  const rawMap = new Map<string, { requests: number; blocked: number }>();

  for (const r of records) {
    const ts = parseRecordTimestamp(r.timestamp);
    if (!Number.isFinite(ts) || ts < sinceMs || ts > endMs) continue;
    const key = bucketKey(ts, granularity);
    const cur = rawMap.get(key) || { requests: 0, blocked: 0 };
    cur.requests++;
    if (r.blocked) cur.blocked++;
    rawMap.set(key, cur);
  }

  const raw = buckets.map((b) => {
    const cur = rawMap.get(b) || { requests: 0, blocked: 0 };
    return { bucket: b, requests: cur.requests, blocked: cur.blocked };
  });

  const filled = fillTimeSeries(raw, 'bucket', buckets, ['requests', 'blocked']);
  return filled.points.map((p) => ({
    bucket: String(p.bucket),
    requests: Number(p.requests) || 0,
    blocked: Number(p.blocked) || 0,
  }));
}

function mapTransport(t: string): 'stdio' | 'http' | 'https' | 'mTLS' {
  const lower = t.toLowerCase();
  if (lower.includes('mtls')) return 'mTLS';
  if (lower.includes('https')) return 'https';
  if (lower.includes('http') || lower.includes('sse') || lower.includes('ws')) return 'http';
  return 'stdio';
}

function computeServerTrust(
  container: Container,
  server: ServerRegistryEntry,
): TrustScore {
  const blocked = server.metrics?.blocked ?? 0;
  const transport = mapTransport(server.transport);
  return container.mastyfAiScore.compute({
    serverName: server.name,
    cveCount: 0,
    maxCvss: 0,
    newestCveAgeDays: 0,
    authMethod: 'none',
    transport,
    highRiskToolCount: 0,
    mediumRiskToolCount: 0,
    totalToolCount: server.metrics?.topTools?.length ?? 0,
    trustedPublisher: false,
    typoSquatDetected: false,
    depConfusionDetected: false,
    blockedCalls: blocked,
    bypassedAttacks: 0,
    responseDlpActive: true,
    mastyfAiProtected: true,
  });
}

export async function buildAgenticDashboardSummary(
  db: IDatabase | null,
  container: Container | null,
  tenantId: string | undefined,
  windowDaysInput: number | string,
): Promise<AgenticDashboardSummary> {
  const windowDays = parseWindowDays(String(windowDaysInput));
  const { startMs, endMs } = windowRangeMs(windowDays);
  const granularity = bucketGranularityForWindow(windowDays);
  const generatedAt = new Date().toISOString();
  const dataSources: string[] = [];

  let records: ProxyCallRecord[] = [];
  if (db) {
    records = await loadAllRecordsInWindow(db, tenantId, windowDays);
    if (records.length) dataSources.push('history.db');
  }

  const summary = summarizeRecords(records);
  const trafficSeries = buildTrafficSeries(records, startMs, endMs, granularity);

  const taskStats = container?.taskQueue.getStats() ?? {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    total: 0,
  };
  const telemetry = container?.telemetry.getMetrics(taskStats);
  const injectionStats = container?.promptInjectionDetector.getStats() ?? {
    totalScans: 0,
    totalDetections: 0,
    detectionRate: 0,
  };
  const mesh = container?.threatMeshNode.getStats() ?? {
    enabled: false,
    localSignatures: 0,
    pendingSignatures: 0,
  };
  const decoySummary = container?.honeypotManager.getSummary() ?? {
    active: 0,
    totalDeployments: 0,
    totalCaptures: 0,
    recentAlerts: 0,
  };

  const frameworks = container
    ? (['soc2', 'hipaa', 'pci-dss', 'fedramp', 'iso27001'] as const).map((f) =>
        container.controlMapper.evaluate(f, [], []),
      )
    : [];
  const complianceOverall =
    frameworks.length > 0
      ? Math.round(frameworks.reduce((s, p) => s + p.postureScore, 0) / frameworks.length)
      : 0;

  const registry = await getServerRegistry();
  const servers: AgenticServerTrust[] = registry.map((s) => ({
    name: s.name,
    transport: s.transport,
    wrapped: s.wrapped,
    metrics: s.metrics,
    trust: container ? computeServerTrust(container, s) : null,
  }));

  const primaryTrust = servers[0]?.trust ?? null;
  const trustGrade = primaryTrust?.grade ?? '—';
  const trustScore = primaryTrust?.overallScore ?? 0;

  const pgSummary = container?.behaviorCollector.getSummary();
  const trustStats = container?.trustProtocol.getStats() ?? {
    totalNegotiations: 0,
    failedNegotiations: 0,
    activeSessions: 0,
    registeredAgents: 0,
  };

  if (container) dataSources.push('agentic-container');

  const featureHealth = container
    ? [
        { name: 'Policy Generation', status: container.behaviorCollector.isActive() ? 'observing' : 'idle' },
        { name: 'Prompt Injection Detection', status: 'active' },
        { name: 'Threat Prediction', status: 'active' },
        { name: 'Threat Intel Mesh', status: mesh.enabled ? 'active' : 'disabled' },
        { name: 'Decoy Manager', status: `${decoySummary.active} active` },
        { name: 'Trust Negotiation', status: `${trustStats.activeSessions} sessions` },
        { name: 'Compliance Mapping', status: 'active' },
        { name: 'Red Team Engine', status: 'ready' },
      ]
    : [];

  const agenticEnabled = !!container;
  const hasProxyHistory = records.length > 0;
  const windowLabel = windowToLabel(windowDays);

  let historyOutsideWindow: number | undefined;
  let suggestedWindow: DashboardWindow | undefined;
  let emptyReason: string | undefined;

  if (!agenticEnabled) {
    emptyReason =
      'Agentic services not initialized — restart Mastyf AI proxy or enable MASTYF_AI_AGENTIC_ENABLED';
  } else if (!hasProxyHistory && db) {
    const widerRecords = await loadAllRecordsInWindow(db, tenantId, 30);
    if (widerRecords.length > 0) {
      historyOutsideWindow = widerRecords.length;
      suggestedWindow = windowDays < 7 ? '7d' : '30d';
      emptyReason =
        `No proxy traffic in the last ${windowLabel} — ${widerRecords.length.toLocaleString()} calls in the last 30 days. ` +
        'Widen the time window (toolbar above) or run new MCP tools through Mastyf AI.';
    } else {
      emptyReason =
        'No proxy traffic recorded yet — run MCP tools through Mastyf AI proxy (e.g. pnpm real-life:filesystem)';
    }
  } else if (!hasProxyHistory) {
    emptyReason =
      'No proxy traffic in selected window — run MCP tools through Mastyf AI proxy';
  }

  return {
    available: agenticEnabled,
    agenticEnabled,
    hasProxyHistory,
    windowDays,
    windowLabel,
    historyOutsideWindow,
    suggestedWindow,
    generatedAt,
    kpis: container ? {
      uptimeMs: telemetry?.uptimeMs ?? 0,
      totalDecisions: telemetry?.totalDecisions ?? 0,
      avgConfidence: telemetry?.avgConfidence ?? 0,
      llmTokensUsed: telemetry?.llmTokensUsed ?? 0,
      llmCostEstimate: telemetry?.llmCostEstimate ?? 0,
      llmAvailable: container?.modelProvider.isAvailable() ?? false,
      blockedRequests: summary.blocked,
      totalRequests: summary.total,
      injectionDetectionRate: injectionStats.detectionRate,
      injectionScans: injectionStats.totalScans,
      meshSignatures: mesh.localSignatures,
      meshEnabled: mesh.enabled,
      decoyActive: decoySummary.active,
      decoyCaptures: decoySummary.totalCaptures,
      taskQueued: taskStats.queued,
      taskRunning: taskStats.running,
      complianceOverall,
      trustGrade,
      trustScore,
      activeSessions: trustStats.activeSessions,
    } : null,
    trafficSeries,
    decisionsByFeature: telemetry?.decisionsByFeature ?? {},
    recentDecisions: container?.telemetry.getRecentDecisions(30) ?? [],
    featureHealth,
    servers,
    compliance: {
      overall: complianceOverall,
      frameworks: frameworks.map((f) => ({
        framework: f.framework,
        frameworkName: f.frameworkName,
        postureScore: f.postureScore,
        satisfiedControls: f.satisfiedControls,
        totalControls: f.totalControls,
      })),
    },
    policyGen: {
      active: container?.behaviorCollector.isActive() ?? false,
      totalCalls: pgSummary?.totalCalls ?? 0,
      uniqueTools: pgSummary?.uniqueTools ?? 0,
      uptimeMin: pgSummary?.uptimeMin ?? 0,
    },
    decoys: container ? {
      active: decoySummary.active,
      totalCaptures: decoySummary.totalCaptures,
      recentAlerts: decoySummary.recentAlerts,
    } : null,
    mesh: {
      enabled: mesh.enabled,
      localSignatures: mesh.localSignatures,
      pendingSignatures: mesh.pendingSignatures,
    },
    promptInjectionStats: injectionStats,
    trustSessions: {
      activeSessions: trustStats.activeSessions,
      registeredAgents: trustStats.registeredAgents,
      totalNegotiations: trustStats.totalNegotiations,
    },
    meta: buildChartMeta({
      windowDays,
      recordCount: records.length,
      dataSources,
      generatedAt,
      emptyReason,
    }),
    emptyReason,
  };
}

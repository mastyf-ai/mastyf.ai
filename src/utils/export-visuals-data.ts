/**
 * Chart-ready bundle for security-swarm visuals (history.db, AI learning, semantic, regression).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createDatabase } from '../database/create-database.js';
import { resolveGuardianDbPath } from './guardian-db-path.js';
import { getAllActiveServerNames, loadAllCallRecords } from './db-aggregate.js';
import type { ProxyCallRecord } from '../types.js';
import { resolveAttackLearningStatePath, resolveAiPendingSuggestionsPath, resolveAiLearningStatePath, resolveAiBaselinesPath } from '../ai/ai-paths.js';
import type { AttackLearningState } from '../ai/instant-attack-learning.js';
import type { LearningState } from '../ai/self-improvement.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { getEffectiveSwarmDir, resolveTenantSwarmDir } from '../tenant/swarm-tenant-paths.js';
import { REPO_ROOT } from './swarm-artifacts.js';
import { loadSemanticAuditRecordsAsync } from '../ai/semantic-audit-store.js';
import { buildSemanticVisualsFromRecords } from './semantic-visuals.js';
import { isSwarmSessionActiveForTenant, isStrictLiveDashboard } from './swarm-session.js';
import {
  fillTimeSeries,
  filterRecordsInWindow,
  generateTimeBuckets,
  parseRecordTimestamp,
  parseWindowDays,
  windowRangeMs,
} from './time-buckets.js';
import { buildChartMeta } from './chart-meta.js';


const RULE_GLOSSARY: Record<string, string> = {
  'request-prompt-injection': 'Prompt injection in tool args',
  'path-traversal': 'Path traversal',
  'secret-leak': 'Secret leak',
  'sql-injection': 'SQL injection',
  'shell-injection': 'Shell injection',
  'path-guard': 'Path guard',
  'semantic-shell-guard': 'Semantic shell guard',
  'secret-scan': 'Secret scan',
};

export interface HourlyBucket {
  hourStart: string;
  calls: number;
  blocked: number;
  passed: number;
  passRatePct: number;
  costUsd: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

export interface VisualsDataBundle {
  generatedAt: string;
  windowDays: number;
  meta: {
    dbPath: string;
    tenantId?: string;
    hasTraffic: boolean;
    hasInstantLearning: boolean;
    hasSemantic: boolean;
    swarmSessionLive: boolean;
    dataSources: {
      traffic: 'history.db' | 'none';
      semantic: 'semantic-audit-store' | 'none';
      regression: 'session-swarm' | 'none';
      pipeline: 'session-swarm' | 'none';
    };
    emptyReasons: Record<string, string>;
    recordCount?: number;
    sparse?: boolean;
    window?: string;
    generatedAt?: string;
  };
  traffic: {
    hasData: boolean;
    totalCalls: number;
    totalBlocked: number;
    hourly: HourlyBucket[];
    byServer: Array<{
      serverName: string;
      calls: number;
      blocked: number;
      costUsd: number;
      latencyP50Ms: number;
      latencyP95Ms: number;
    }>;
    topTools: Array<{ tool: string; count: number }>;
    topBlockRules: Array<{ rule: string; count: number; plainEnglish: string }>;
  };
  instantLearning: {
    source: 'live' | 'history-db-fallback' | 'simulated-eval' | 'none';
    totalEvents: number;
    queuedSuggestions: number;
    blocksPerMinute: Array<{ t: number; value: number }>;
    ruleToolPairs: Array<{ key: string; rule: string; tool: string; count: number }>;
    classConfidence: Array<{ class: string; confidence: number }>;
    medianBlocksToSuggestion?: number;
    suggestionEngine?: {
      learningInitialized: boolean;
      cyclesCompleted: number;
      baselinesCount: number;
      recordsAnalyzed: number;
      suggestionsGenerated: number;
    };
  };
  semantic: {
    hasData: boolean;
    totals: Record<string, number>;
    confidenceBuckets: Array<{ bucket: string; count: number }>;
    labelMix: Array<{ label: string; count: number }>;
    avgFlagConfidence: number;
  };
  regression: {
    gates: Record<string, unknown> | null;
    overall: boolean | null;
    categoryRecall: Array<{ category: string; recallPct: number; total: number }>;
    userServers: Array<{ serverName: string; status: string; toolCount: number }>;
  };
  pipeline: {
    phases: Array<{ id: string; label: string; progressPct: number }>;
    jobState: string | null;
    stepTimings: Array<{ label: string; elapsedSec: number }>;
    totalSec: number;
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function buildHourlyBuckets(
  records: ProxyCallRecord[],
  sinceMs: number,
  endMs: number,
): { hourly: HourlyBucket[]; sparse: boolean } {
  const buckets = generateTimeBuckets(sinceMs, endMs, 'hour');
  const rawMap = new Map<number, ProxyCallRecord[]>();
  for (const r of records) {
    const t = parseRecordTimestamp(r.timestamp);
    if (!Number.isFinite(t) || t < sinceMs || t > endMs) continue;
    const hour = Math.floor(t / 3_600_000) * 3_600_000;
    const list = rawMap.get(hour) ?? [];
    list.push(r);
    rawMap.set(hour, list);
  }

  const rawHourly = [...rawMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hourMs, recs]) => {
      let blocked = 0;
      let costUsd = 0;
      const latencies: number[] = [];
      for (const r of recs) {
        if (r.blocked) blocked++;
        if (r.costUsd) costUsd += r.costUsd;
        if (r.durationMs) latencies.push(r.durationMs);
      }
      latencies.sort((a, b) => a - b);
      const total = recs.length;
      return {
        hourStart: new Date(hourMs).toISOString(),
        calls: total,
        blocked,
        passed: total - blocked,
        passRatePct: total ? Math.round(((total - blocked) / total) * 1000) / 10 : 0,
        costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
        latencyP50Ms: percentile(latencies, 50),
        latencyP95Ms: percentile(latencies, 95),
      };
    });

  const filled = fillTimeSeries(rawHourly, 'hourStart', buckets, ['calls', 'blocked', 'passed']);
  const hourly = filled.points.map((p) => {
    const existing = rawHourly.find((h) => h.hourStart === p.hourStart);
    if (existing) return existing;
    return {
      hourStart: String(p.hourStart),
      calls: 0,
      blocked: 0,
      passed: 0,
      passRatePct: 0,
      costUsd: 0,
      latencyP50Ms: 0,
      latencyP95Ms: 0,
    };
  });

  return { hourly, sparse: filled.sparse };
}

function loadAttackLearningState(tenantId?: string): AttackLearningState | null {
  const p = resolveAttackLearningStatePath(tenantId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as AttackLearningState;
  } catch {
    return null;
  }
}

function loadSuggestionEngineSlice(tenantId?: string): VisualsDataBundle['instantLearning']['suggestionEngine'] {
  const learningPath = resolveAiLearningStatePath(tenantId);
  let learning: LearningState | null = null;
  if (existsSync(learningPath)) {
    try {
      learning = JSON.parse(readFileSync(learningPath, 'utf-8')) as LearningState;
    } catch { /* ignore */ }
  }
  let baselinesCount = learning?.baselinesLearned ?? 0;
  const baselinesPath = resolveAiBaselinesPath(tenantId);
  if (existsSync(baselinesPath)) {
    try {
      const raw = JSON.parse(readFileSync(baselinesPath, 'utf-8')) as { baselines?: unknown[] } | unknown[];
      if (Array.isArray(raw)) baselinesCount = raw.length;
      else if (Array.isArray(raw.baselines)) baselinesCount = raw.baselines.length;
    } catch { /* ignore */ }
  }
  if (!learning?.learningInitialized && baselinesCount === 0) return undefined;
  return {
    learningInitialized: learning?.learningInitialized ?? false,
    cyclesCompleted: learning?.cyclesCompleted ?? 0,
    baselinesCount,
    recordsAnalyzed: learning?.recordsAnalyzed ?? 0,
    suggestionsGenerated: learning?.suggestionsGenerated ?? 0,
  };
}

function loadPendingSuggestionCount(tenantId?: string): number {
  const pendingPath = resolveAiPendingSuggestionsPath(tenantId);
  if (!existsSync(pendingPath)) return 0;
  try {
    const raw = JSON.parse(readFileSync(pendingPath, 'utf-8')) as { suggestions?: unknown[] };
    return Array.isArray(raw.suggestions) ? raw.suggestions.length : 0;
  } catch {
    return 0;
  }
}

function blocksPerHourFromTraffic(hourly: HourlyBucket[]): Array<{ t: number; value: number }> {
  return hourly
    .filter((h) => h.blocked > 0)
    .map((h, i) => ({ t: i * 3_600_000, value: h.blocked }));
}

function ruleToolPairsFromHistory(ruleCounts: Map<string, number>): Array<{ key: string; rule: string; tool: string; count: number }> {
  return [...ruleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([rule, count]) => ({
      key: `${rule}:*`,
      rule,
      tool: '*',
      count,
    }));
}

function instantLearningFromHistory(
  totalBlocked: number,
  hourly: HourlyBucket[],
  ruleCounts: Map<string, number>,
  pendingSuggestions: number,
  suggestionEngine: VisualsDataBundle['instantLearning']['suggestionEngine'],
): VisualsDataBundle['instantLearning'] {
  return {
    source: 'history-db-fallback',
    totalEvents: totalBlocked,
    queuedSuggestions: pendingSuggestions,
    blocksPerMinute: blocksPerHourFromTraffic(hourly),
    ruleToolPairs: ruleToolPairsFromHistory(ruleCounts),
    classConfidence: [],
    suggestionEngine,
  };
}

function attackStateHasChartSeries(state: AttackLearningState): boolean {
  const pairs = Object.keys(state.ruleToolCounts ?? {}).length;
  const recent = state.recentBlocks?.length ?? 0;
  return pairs > 0 || recent > 0;
}

function blocksPerMinuteFromRecent(state: AttackLearningState): Array<{ t: number; value: number }> {
  const blocks = state.recentBlocks ?? [];
  if (!blocks.length) return [];
  const minTs = Math.min(...blocks.map((b) => new Date(b.ts).getTime()));
  const bucketMs = 60_000;
  const counts = new Map<number, number>();
  for (const b of blocks) {
    const t = new Date(b.ts).getTime();
    const slot = Math.floor((t - minTs) / bucketMs) * bucketMs;
    counts.set(slot, (counts.get(slot) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, value]) => ({ t, value }));
}

function loadJsonSafe<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export async function buildVisualsData(opts: {
  windowDays?: number;
  dbPath?: string;
  tenantId?: string;
  /** Reuse proxy/dashboard DB — avoids open/close churn on /api/visuals/live */
  historyDb?: Awaited<ReturnType<typeof createDatabase>>;
} = {}): Promise<VisualsDataBundle> {
  const windowDays = parseWindowDays(opts.windowDays ?? 7);
  const tenantId = opts.tenantId || DEFAULT_TENANT_ID;
  const swarmDir = getEffectiveSwarmDir(tenantId);
  const swarmSessionLive = isSwarmSessionActiveForTenant(tenantId);
  const dbPath = opts.dbPath ?? resolveGuardianDbPath();
  const { startMs, endMs } = windowRangeMs(windowDays);
  const sinceMs = startMs;
  const emptyReasons: Record<string, string> = {};

  let allRecords: ProxyCallRecord[] = [];
  let ownDb = false;
  let db = opts.historyDb;
  try {
    if (!db) {
      db = await createDatabase(dbPath);
      await db.initialize();
      ownDb = true;
    }
    const servers = await getAllActiveServerNames(db, tenantId);
    allRecords = await loadAllCallRecords(db, servers, tenantId);
  } catch (err) {
    emptyReasons.traffic = `history.db: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    if (ownDb && db?.close) {
      await db.close();
    }
  }

  const windowRecords = filterRecordsInWindow(allRecords, sinceMs, endMs);

  const { hourly, sparse: trafficSparse } = buildHourlyBuckets(windowRecords, sinceMs, endMs);
  const serverMap = new Map<string, ProxyCallRecord[]>();
  const toolCounts = new Map<string, number>();
  const ruleCounts = new Map<string, number>();

  for (const r of windowRecords) {
    const s = r.serverName || 'unknown';
    const list = serverMap.get(s) ?? [];
    list.push(r);
    serverMap.set(s, list);
    const tool = r.toolName || '(unknown)';
    toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
    if (r.blocked && r.blockRule) {
      ruleCounts.set(r.blockRule, (ruleCounts.get(r.blockRule) || 0) + 1);
    }
  }

  const byServer = [...serverMap.entries()].map(([serverName, recs]) => {
    let blocked = 0;
    let costUsd = 0;
    const latencies: number[] = [];
    for (const r of recs) {
      if (r.blocked) blocked++;
      if (r.costUsd) costUsd += r.costUsd;
      if (r.durationMs) latencies.push(r.durationMs);
    }
    latencies.sort((a, b) => a - b);
    return {
      serverName,
      calls: recs.length,
      blocked,
      costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      latencyP50Ms: percentile(latencies, 50),
      latencyP95Ms: percentile(latencies, 95),
    };
  }).sort((a, b) => b.calls - a.calls);

  const totalBlocked = windowRecords.filter((r) => r.blocked).length;
  if (!windowRecords.length) {
    const windowLabel = windowDays <= 1 / 24 ? '1h' : windowDays <= 1 ? '24h' : `${Math.round(windowDays)}d`;
    emptyReasons.traffic =
      `No proxied calls in the last ${windowLabel} — widen the dashboard time window or route MCP through Guardian (proxy and dashboard must share MCP_GUARDIAN_DB_PATH).`;
  }

  const attackState = loadAttackLearningState(tenantId);
  const suggestionEngine = loadSuggestionEngineSlice(tenantId);
  const pendingSuggestions = loadPendingSuggestionCount(tenantId);
  let instantLearning: VisualsDataBundle['instantLearning'] = {
    source: 'none',
    totalEvents: 0,
    queuedSuggestions: pendingSuggestions,
    blocksPerMinute: [],
    ruleToolPairs: [],
    classConfidence: [],
    suggestionEngine,
  };

  if (attackState && attackState.totalEvents > 0 && attackStateHasChartSeries(attackState)) {
    const pairs: Array<{ key: string; rule: string; tool: string; count: number }> = [];
    for (const [key, stats] of Object.entries(attackState.ruleToolCounts ?? {})) {
      const [rule, tool] = key.split(':');
      pairs.push({ key, rule: rule || key, tool: tool || '?', count: stats.count });
    }
    pairs.sort((a, b) => b.count - a.count);
    instantLearning = {
      source: 'live',
      totalEvents: attackState.totalEvents,
      queuedSuggestions: pendingSuggestions || (attackState.queuedSuggestionKeys?.length ?? 0),
      blocksPerMinute: blocksPerMinuteFromRecent(attackState),
      ruleToolPairs: pairs.slice(0, 20),
      classConfidence: Object.entries(attackState.knownClassConfidence ?? {}).map(([cls, confidence]) => ({
        class: cls,
        confidence,
      })),
      suggestionEngine,
    };
  } else if (totalBlocked > 0) {
    instantLearning = instantLearningFromHistory(
      totalBlocked,
      hourly,
      ruleCounts,
      pendingSuggestions,
      suggestionEngine,
    );
    emptyReasons.instantLearning = attackState?.totalEvents
      ? 'Attack-learning counters exist but chart series are empty — showing history.db block trends.'
      : 'Using history.db block counts — instant attack-learning state will populate after live proxy blocks.';
  } else {
    emptyReasons.instantLearning =
      'No live attack-learning state yet — blocks from the proxy will populate ~/.mcp-guardian/.attack-learning-state.json.';
  }

  const semanticRecords = await loadSemanticAuditRecordsAsync({
    tenantId,
    sinceMs: Math.max(windowDays, 30) * 24 * 60 * 60 * 1000,
    limit: 2000,
  });
  const semanticSlice = buildSemanticVisualsFromRecords(semanticRecords);
  if (!semanticSlice.hasData) {
    emptyReasons.semantic =
      'No live semantic audit outcomes in the last 30 days — enable GUARDIAN_LLM_ENABLED + GUARDIAN_SEMANTIC_ASYNC on the proxy and route MCP traffic through Guardian.';
  }

  let latest: Record<string, unknown> | null = null;
  let corpus: { byCategory?: Array<{ category: string; recall: number; total: number }> } | null = null;
  let userSession: { servers?: Array<{ serverName: string; status: string; toolCount?: number }> } | null = null;
  let job: { state?: string; phase?: string } | null = null;

  if (swarmSessionLive || !isStrictLiveDashboard()) {
    latest = loadJsonSafe<Record<string, unknown>>(join(swarmDir, 'latest.json'));
    corpus = loadJsonSafe<{ byCategory?: Array<{ category: string; recall: number; total: number }> }>(
      join(REPO_ROOT, 'corpus-eval-report.json'),
    );
    userSession = loadJsonSafe<{ servers?: Array<{ serverName: string; status: string; toolCount?: number }> }>(
      join(swarmDir, 'user-servers-session.json'),
    );
    job = loadJsonSafe<{ state?: string; phase?: string }>(join(swarmDir, 'job.json'));
  } else {
    emptyReasons.regression =
      'Batch regression data appears after you run Security Swarm in this dashboard session.';
    emptyReasons.pipeline = emptyReasons.regression;
  }

  const phases = [
    { id: 'preflight', label: 'Preflight', progressPct: 5 },
    { id: 'live-mcp', label: 'Live MCP', progressPct: 25 },
    { id: 'traffic', label: 'Traffic', progressPct: 42 },
    { id: 'swarm', label: 'Swarm gates', progressPct: 75 },
    { id: 'visuals', label: 'Visuals', progressPct: 88 },
  ];
  const timings = latest?.timings as { totalSec?: number; steps?: Array<{ label: string; elapsedSec: number }> } | undefined;

  const chartMeta = buildChartMeta({
    windowDays,
    recordCount: windowRecords.length,
    sparse: trafficSparse,
    dataSources: ['history.db'],
    emptyReason: windowRecords.length === 0 ? emptyReasons.traffic : undefined,
  });

  return {
    generatedAt: chartMeta.generatedAt,
    windowDays,
    meta: {
      dbPath,
      tenantId,
      hasTraffic: windowRecords.length > 0,
      hasInstantLearning: instantLearning.source === 'live' || instantLearning.source === 'history-db-fallback',
      hasSemantic: semanticSlice.hasData,
      swarmSessionLive,
      recordCount: chartMeta.recordCount,
      sparse: chartMeta.sparse,
      window: chartMeta.window,
      generatedAt: chartMeta.generatedAt,
      dataSources: {
        traffic: windowRecords.length > 0 ? 'history.db' : 'none',
        semantic: semanticSlice.hasData ? 'semantic-audit-store' : 'none',
        regression: swarmSessionLive && latest ? 'session-swarm' : 'none',
        pipeline: swarmSessionLive && job ? 'session-swarm' : 'none',
      },
      emptyReasons,
    },
    traffic: {
      hasData: windowRecords.length > 0,
      totalCalls: windowRecords.length,
      totalBlocked,
      hourly,
      byServer,
      topTools: [...toolCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([tool, count]) => ({ tool, count })),
      topBlockRules: [...ruleCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([rule, count]) => ({
          rule,
          count,
          plainEnglish: RULE_GLOSSARY[rule] || rule,
        })),
    },
    instantLearning,
    semantic: {
      hasData: semanticSlice.hasData,
      totals: semanticSlice.totals,
      confidenceBuckets: semanticSlice.confidenceBuckets,
      labelMix: semanticSlice.labelMix,
      avgFlagConfidence: semanticSlice.avgFlagConfidence,
    },
    regression: {
      gates: (latest?.gates as Record<string, unknown>) ?? null,
      overall: latest?.overall != null ? Boolean(latest.overall) : null,
      categoryRecall: (corpus?.byCategory ?? [])
        .filter((c) => c.category !== 'benign')
        .map((c) => ({
          category: c.category,
          recallPct: Math.round((c.recall ?? 0) * 1000) / 10,
          total: c.total ?? 0,
        })),
      userServers: (userSession?.servers ?? []).map((s) => ({
        serverName: s.serverName,
        status: s.status,
        toolCount: s.toolCount ?? 0,
      })),
    },
    pipeline: {
      phases,
      jobState: job?.state ?? null,
      stepTimings: timings?.steps ?? [],
      totalSec: timings?.totalSec ?? 0,
    },
  };
}

export async function writeVisualsData(opts?: {
  windowDays?: number;
  dbPath?: string;
  tenantId?: string;
  historyDb?: Awaited<ReturnType<typeof createDatabase>>;
}): Promise<VisualsDataBundle> {
  const tenantId = opts?.tenantId || DEFAULT_TENANT_ID;
  const outDir = resolveTenantSwarmDir(tenantId);
  mkdirSync(outDir, { recursive: true });
  const bundle = await buildVisualsData({ ...opts, tenantId });
  const path = join(outDir, 'visuals-data.json');
  writeFileSync(path, JSON.stringify(bundle, null, 2) + '\n', 'utf-8');
  return bundle;
}

export function readVisualsData(tenantId?: string): VisualsDataBundle | null {
  const path = join(getEffectiveSwarmDir(tenantId || DEFAULT_TENANT_ID), 'visuals-data.json');
  return loadJsonSafe<VisualsDataBundle>(path);
}

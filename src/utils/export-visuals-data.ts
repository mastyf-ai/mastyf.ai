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
import { resolveAttackLearningStatePath, resolveAiPendingSuggestionsPath } from '../ai/ai-paths.js';
import type { AttackLearningState } from '../ai/instant-attack-learning.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { getEffectiveSwarmDir, resolveTenantSwarmDir } from '../tenant/swarm-tenant-paths.js';
import { REPO_ROOT } from './swarm-artifacts.js';


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
    emptyReasons: Record<string, string>;
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
    source: 'live' | 'simulated-eval' | 'none';
    totalEvents: number;
    queuedSuggestions: number;
    blocksPerMinute: Array<{ t: number; value: number }>;
    ruleToolPairs: Array<{ key: string; rule: string; tool: string; count: number }>;
    classConfidence: Array<{ class: string; confidence: number }>;
    medianBlocksToSuggestion?: number;
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

function buildHourlyBuckets(records: ProxyCallRecord[], sinceMs: number): HourlyBucket[] {
  const buckets = new Map<number, ProxyCallRecord[]>();
  for (const r of records) {
    const t = new Date(r.timestamp || 0).getTime();
    if (Number.isNaN(t) || t < sinceMs) continue;
    const hour = Math.floor(t / 3_600_000) * 3_600_000;
    const list = buckets.get(hour) ?? [];
    list.push(r);
    buckets.set(hour, list);
  }
  return [...buckets.entries()]
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
  const windowDays = opts.windowDays ?? 7;
  const tenantId = opts.tenantId || DEFAULT_TENANT_ID;
  const swarmDir = getEffectiveSwarmDir(tenantId);
  const dbPath = opts.dbPath ?? resolveGuardianDbPath();
  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
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

  const windowRecords = allRecords.filter((r) => {
    const t = new Date(r.timestamp || 0).getTime();
    return !Number.isNaN(t) && t >= sinceMs;
  });

  const hourly = buildHourlyBuckets(windowRecords, sinceMs);
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
    emptyReasons.traffic = 'No proxied calls in window — use IDE MCP through Guardian proxy.';
  }

  const attackState = loadAttackLearningState(tenantId);
  let instantLearning: VisualsDataBundle['instantLearning'] = {
    source: 'none',
    totalEvents: 0,
    queuedSuggestions: 0,
    blocksPerMinute: [],
    ruleToolPairs: [],
    classConfidence: [],
  };

  if (attackState && attackState.totalEvents > 0) {
    const pairs: Array<{ key: string; rule: string; tool: string; count: number }> = [];
    for (const [key, stats] of Object.entries(attackState.ruleToolCounts ?? {})) {
      const [rule, tool] = key.split(':');
      pairs.push({ key, rule: rule || key, tool: tool || '?', count: stats.count });
    }
    pairs.sort((a, b) => b.count - a.count);
    let pending = 0;
    const pendingPath = resolveAiPendingSuggestionsPath(tenantId);
    if (existsSync(pendingPath)) {
      try {
        const raw = JSON.parse(readFileSync(pendingPath, 'utf-8')) as { suggestions?: unknown[] };
        pending = Array.isArray(raw.suggestions) ? raw.suggestions.length : 0;
      } catch { /* ignore */ }
    }
    instantLearning = {
      source: 'live',
      totalEvents: attackState.totalEvents,
      queuedSuggestions: pending || (attackState.queuedSuggestionKeys?.length ?? 0),
      blocksPerMinute: blocksPerMinuteFromRecent(attackState),
      ruleToolPairs: pairs.slice(0, 20),
      classConfidence: Object.entries(attackState.knownClassConfidence ?? {}).map(([cls, confidence]) => ({
        class: cls,
        confidence,
      })),
    };
  } else {
    emptyReasons.instantLearning = 'No live attack-learning state yet — blocks from the proxy will populate ~/.mcp-guardian/.attack-learning-state.json.';
  }

  const cal = loadJsonSafe<{
    totals?: Record<string, number>;
    metrics?: { avgFlagConfidence?: number };
    sampleFlagged?: Array<{ confidence?: number; label?: string | null }>;
  }>(join(swarmDir, 'calibration.json'));

  const confidenceBuckets = new Map<string, number>();
  const labelMix = new Map<string, number>();
  if (cal?.sampleFlagged?.length) {
    for (const s of cal.sampleFlagged) {
      const c = s.confidence ?? 0;
      const bucket = c < 0.5 ? '0.0-0.5' : c < 0.7 ? '0.5-0.7' : c < 0.85 ? '0.7-0.85' : '0.85-1.0';
      confidenceBuckets.set(bucket, (confidenceBuckets.get(bucket) || 0) + 1);
      const lab = s.label || 'unlabeled';
      labelMix.set(lab, (labelMix.get(lab) || 0) + 1);
    }
  }

  const semanticHas = !!(cal?.totals?.records);
  if (!semanticHas) {
    emptyReasons.semantic = 'No calibration.json or empty semantic outcomes.';
  }

  const latest = loadJsonSafe<Record<string, unknown>>(join(swarmDir, 'latest.json'));
  const corpus = loadJsonSafe<{ byCategory?: Array<{ category: string; recall: number; total: number }> }>(
    join(REPO_ROOT, 'corpus-eval-report.json'),
  );
  const userSession = loadJsonSafe<{ servers?: Array<{ serverName: string; status: string; toolCount?: number }> }>(
    join(swarmDir, 'user-servers-session.json'),
  );

  const job = loadJsonSafe<{ state?: string; phase?: string }>(join(swarmDir, 'job.json'));
  const phases = [
    { id: 'preflight', label: 'Preflight', progressPct: 5 },
    { id: 'live-mcp', label: 'Live MCP', progressPct: 25 },
    { id: 'traffic', label: 'Traffic', progressPct: 42 },
    { id: 'swarm', label: 'Swarm gates', progressPct: 75 },
    { id: 'visuals', label: 'Visuals', progressPct: 88 },
  ];
  const timings = latest?.timings as { totalSec?: number; steps?: Array<{ label: string; elapsedSec: number }> } | undefined;

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    meta: {
      dbPath,
      tenantId,
      hasTraffic: windowRecords.length > 0,
      hasInstantLearning: instantLearning.source === 'live',
      hasSemantic: semanticHas,
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
      hasData: semanticHas,
      totals: cal?.totals ?? {},
      confidenceBuckets: [...confidenceBuckets.entries()].map(([bucket, count]) => ({ bucket, count })),
      labelMix: [...labelMix.entries()].map(([label, count]) => ({ label, count })),
      avgFlagConfidence: cal?.metrics?.avgFlagConfidence ?? 0,
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

/**
 * Executive summary rollup for enterprise dashboard overview.
 */
import type { IDatabase } from '../database/database-interface.js';
import type { ProxyCallRecord } from '../types.js';
import {
  getAllActiveServerNames,
  loadAllCallRecords,
  summarizeRecords,
} from './db-aggregate.js';
import { computeBurnRatePerHour, computeProjectedMonthly } from './cost-metrics.js';
import { parseCostBudgetUsd } from './dashboard-live-data.js';
import { buildChartMeta, type ChartMetaEnvelope } from './chart-meta.js';
import {
  bucketGranularityForWindow,
  computeComparison,
  fillTimeSeries,
  filterRecordsInWindow,
  generateTimeBuckets,
  parseRecordTimestamp,
  parseWindowDays,
  windowRangeMs,
} from './time-buckets.js';

export type KpiComparison = {
  deltaPct: number | null;
  deltaAbs: number;
  direction: 'up' | 'down' | 'flat';
};

export type ExecutiveSummary = {
  timestamp: string;
  windowDays: number;
  totalRequests: number;
  blockedRequests: number;
  passedRequests: number;
  passRatePct: number | null;
  blockRatePct: number | null;
  totalCostUsd: number;
  burnRatePerHour: number;
  projectedMonthlyUsd: number;
  avgLatencyMs: number;
  activeServers: number;
  budgetUsd: number | null;
  budgetUtilizationPct: number | null;
  runwayDays: number | null;
  topServersByCost: Array<{ server: string; costUsd: number; calls: number }>;
  topToolsByCalls: Array<{ tool: string; calls: number }>;
  meta: ChartMetaEnvelope;
  comparison?: {
    totalRequests: KpiComparison;
    blockedRequests: KpiComparison;
    totalCostUsd: KpiComparison;
    passRatePct: KpiComparison;
  };
  sparklines?: {
    totalCalls: number[];
    blocked: number[];
    costUsd: number[];
  };
};

function buildSparklines(
  records: ProxyCallRecord[],
  windowDays: number,
  startMs: number,
  endMs: number,
): ExecutiveSummary['sparklines'] {
  const granularity = bucketGranularityForWindow(windowDays);
  const buckets = generateTimeBuckets(startMs, endMs, granularity);
  const dailyCounts = new Map<string, { total: number; blocked: number; costUsd: number }>();

  for (const r of records) {
    const ts = parseRecordTimestamp(r.timestamp);
    if (!Number.isFinite(ts)) continue;
    const bucket =
      granularity === 'hour'
        ? new Date(ts).toISOString().slice(0, 13) + ':00:00.000Z'
        : new Date(ts).toISOString().slice(0, 10);
    const cur = dailyCounts.get(bucket) || { total: 0, blocked: 0, costUsd: 0 };
    cur.total++;
    if (r.blocked) cur.blocked++;
    cur.costUsd += Number(r.costUsd) || 0;
    dailyCounts.set(bucket, cur);
  }

  const raw = buckets.map((bucket) => {
    const c = dailyCounts.get(bucket) || { total: 0, blocked: 0, costUsd: 0 };
    return { bucket, ...c };
  });

  const filled = fillTimeSeries(raw, 'bucket', buckets, ['total', 'blocked', 'costUsd']);

  return {
    totalCalls: filled.points.map((p) => p.total as number),
    blocked: filled.points.map((p) => p.blocked as number),
    costUsd: filled.points.map((p) => Math.round((p.costUsd as number) * 1_000_000) / 1_000_000),
  };
}

function summarizeWindow(records: ProxyCallRecord[]) {
  const sum = summarizeRecords(records);
  const passRatePct = sum.total > 0 ? (sum.passed / sum.total) * 100 : null;
  return { sum, passRatePct };
}

export async function buildExecutiveSummary(
  db: IDatabase,
  tenantId: string | undefined,
  windowDaysInput = 7,
): Promise<ExecutiveSummary> {
  const windowDays = parseWindowDays(windowDaysInput);
  const { startMs, endMs, priorStartMs, priorEndMs } = windowRangeMs(windowDays);
  const srvs = await getAllActiveServerNames(db, tenantId);
  const allRecords = await loadAllCallRecords(db, srvs, tenantId);
  const records = filterRecordsInWindow(allRecords, startMs, endMs);
  const priorRecords = filterRecordsInWindow(allRecords, priorStartMs, priorEndMs);

  const { sum, passRatePct } = summarizeWindow(records);
  const prior = summarizeWindow(priorRecords);

  const burnRatePerHour = computeBurnRatePerHour(sum.costUsd, records);
  const projectedMonthlyUsd = computeProjectedMonthly(sum.costUsd, records);
  const budgetUsd = parseCostBudgetUsd();
  const budgetUtilizationPct =
    budgetUsd != null && budgetUsd > 0 ? (sum.costUsd / budgetUsd) * 100 : null;
  const runwayDays =
    burnRatePerHour > 0 && budgetUsd != null
      ? Math.max(0, (budgetUsd - sum.costUsd) / (burnRatePerHour * 24))
      : null;

  const byServer = new Map<string, { costUsd: number; calls: number }>();
  const byTool = new Map<string, number>();
  for (const r of records) {
    const srv = r.serverName || 'unknown';
    const cur = byServer.get(srv) || { costUsd: 0, calls: 0 };
    cur.calls++;
    cur.costUsd += Number(r.costUsd) || 0;
    byServer.set(srv, cur);
    const tool = r.toolName || 'unknown';
    byTool.set(tool, (byTool.get(tool) || 0) + 1);
  }

  const topServersByCost = [...byServer.entries()]
    .map(([server, v]) => ({ server, ...v }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 8);

  const topToolsByCalls = [...byTool.entries()]
    .map(([tool, calls]) => ({ tool, calls }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10);

  const granularity = bucketGranularityForWindow(windowDays);
  const buckets = generateTimeBuckets(startMs, endMs, granularity);
  const bucketCounts = new Map<string, number>();
  for (const r of records) {
    const ts = parseRecordTimestamp(r.timestamp);
    if (!Number.isFinite(ts)) continue;
    const bucket =
      granularity === 'hour'
        ? new Date(ts).toISOString().slice(0, 13) + ':00:00.000Z'
        : new Date(ts).toISOString().slice(0, 10);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
  }
  const filledBuckets = fillTimeSeries(
    [...bucketCounts.entries()].map(([bucket, count]) => ({ bucket, count })),
    'bucket',
    buckets,
    ['count'],
  );

  const meta = buildChartMeta({
    windowDays,
    recordCount: records.length,
    sparse: filledBuckets.sparse,
    dataSources: ['history.db'],
    emptyReason: records.length === 0 ? 'No proxy traffic in selected window' : undefined,
  });

  return {
    timestamp: meta.generatedAt,
    windowDays,
    totalRequests: sum.total,
    blockedRequests: sum.blocked,
    passedRequests: sum.passed,
    passRatePct: passRatePct != null ? Math.round(passRatePct * 10) / 10 : null,
    blockRatePct:
      passRatePct != null ? Math.round((100 - passRatePct) * 10) / 10 : null,
    totalCostUsd: sum.costUsd,
    burnRatePerHour: Math.round(burnRatePerHour * 1_000_000) / 1_000_000,
    projectedMonthlyUsd: Math.round(projectedMonthlyUsd * 100) / 100,
    avgLatencyMs: sum.total > 0 ? Math.round(sum.totalLatency / sum.total) : 0,
    activeServers: srvs.length,
    budgetUsd,
    budgetUtilizationPct:
      budgetUtilizationPct != null ? Math.round(budgetUtilizationPct * 10) / 10 : null,
    runwayDays: runwayDays != null ? Math.round(runwayDays * 10) / 10 : null,
    topServersByCost,
    topToolsByCalls,
    meta,
    comparison: {
      totalRequests: computeComparison(sum.total, prior.sum.total),
      blockedRequests: computeComparison(sum.blocked, prior.sum.blocked),
      totalCostUsd: computeComparison(sum.costUsd, prior.sum.costUsd),
      passRatePct: computeComparison(passRatePct ?? 0, prior.passRatePct ?? 0),
    },
    sparklines: buildSparklines(records, windowDays, startMs, endMs),
  };
}

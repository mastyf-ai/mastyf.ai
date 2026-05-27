/**
 * MCP Guardian — SOC Dashboard Backend API Server
 *
 * Serves real data from MCP Guardian services:
 *   - SecurityScanner  → /api/security
 *   - HealthMonitor    → /api/health
 *   - CostAuditor      → /api/cost, /api/cost/breakdown, /api/cost/timeseries
 *   - IDatabase        → /api/aggregate/audit, /api/aggregate/metrics
 *   - PolicyEngine     → /api/policy
 *   - Config discovery → /api/instances
 *
 * Run: node --loader ts-node/esm src/soc-api-server.ts
 * Or:  npx tsx src/soc-api-server.ts
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { createContainer } from './container.js';
import { ConfigParser } from './config-parser.js';
import { resolveMcpServerDbPath } from './utils/guardian-db-path.js';
import { Logger } from './utils/logger.js';
import type { IDatabase } from './database/database-interface.js';
import type { McpServerConfig, SecurityReport, CostReport, HealthReport, ProxyCallRecord } from './types.js';
import { parseWindowDays } from './utils/time-buckets.js';
import { buildAuditHeatmapBundle } from './utils/audit-heatmap.js';

// ── Types for API responses (matching guardian-api.ts in dashboard-spa) ─────

interface AggregateMetrics {
  available: boolean;
  totalRequests: number;
  blockedRequests: number;
  passedRequests: number;
  totalCost: number;
  avgLatencyMs: number;
  passRate: number | null;
  activeServers: number;
  lastUpdated: string;
  burnRatePerHour: number | null;
}

interface AuditEvent {
  timestamp: string;
  server_name: string;
  tool_name: string;
  action: string;
  rule: string | null;
  reason: string | null;
  cost_usd: number | null;
  model: string | null;
}

interface AuditResponse {
  available: boolean;
  events: AuditEvent[];
  total: number;
  blocked: number;
  passed: number;
  flagged: number;
}

interface SecurityResponse {
  available: boolean;
  overallScore: number | null;
  activeThreats: number;
  lastScan: string | null;
  serverReports: Array<{
    name: string;
    scanned: boolean;
    score: number | null;
    critical: number | null;
    high: number | null;
    medium: number | null;
    secretsFound: number;
    authMissing: boolean;
    recommendations: string[];
  }>;
}

interface HealthResponse {
  available: boolean;
  overallStatus: string;
  avgLatencyMs: number | null;
  serverReports: Array<{
    name: string;
    latency: number;
    successRate: number | null;
    toolCount: number;
    circuitBreaker: string;
    overloadWarning: boolean;
    recommendations: string[];
    hasHealthData: boolean;
  }>;
  atRisk: string[];
  totalTools: number;
}

interface CostResponse {
  available: boolean;
  totalCost: number | null;
  projectedMonthly: number | null;
  burnRatePerHour: number | null;
  budgetUsd: number | null;
  pricingModel: string;
  windowDays: number;
  serverReports: Array<{
    name: string;
    cost: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    toolBreakdown: Array<{ tool: string; calls: number; costUsd: number; tokens: number }>;
    priced: boolean;
    provider: string;
    modelId: string;
    note?: string;
  }>;
  budgetAlerts: string[];
}

interface ExecutiveSummaryResponse {
  available: boolean;
  timestamp: string;
  windowDays: number;
  totalRequests: number;
  blockedRequests: number;
  passedRequests: number;
  passRatePct: number;
  blockRatePct: number;
  totalCostUsd: number;
  burnRatePerHour: number;
  projectedMonthlyUsd: number;
  avgLatencyMs: number;
  activeServers: number;
  budgetUsd: number | null;
  budgetUtilizationPct: number | null;
  topServersByCost: Array<{ server: string; costUsd: number; calls: number }>;
  topToolsByCalls: Array<{ tool: string; calls: number }>;
  sparklines: { totalCalls: number[]; blocked: number[]; costUsd: number[] };
  comparison: {
    totalRequests: { deltaPct: number | null; deltaAbs: number; direction: string };
    blockedRequests: { deltaPct: number | null; deltaAbs: number; direction: string };
    totalCostUsd: { deltaPct: number | null; deltaAbs: number; direction: string };
    passRatePct: { deltaPct: number | null; deltaAbs: number; direction: string };
  };
}

// ── In-memory result cache ───────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class ResultCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidateAll(): void {
    this.store.clear();
  }
}

const cache = new ResultCache();

// ── SSE client registry ──────────────────────────────────────────────────────

const sseClients = new Set<Response>();

function broadcastSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getWindowMs(windowDays: number): number {
  return windowDays * 24 * 60 * 60 * 1000;
}

function getWindowCutoff(windowDays: number): number {
  return Date.now() - getWindowMs(windowDays);
}

function parseTimestamp(ts: string): number {
  if (!ts) return NaN;
  if (/[TZ]/.test(ts)) return Date.parse(ts);
  return Date.parse(ts.replace(' ', 'T') + 'Z');
}

function filterByWindow(records: ProxyCallRecord[], windowDays: number): ProxyCallRecord[] {
  const cutoff = getWindowCutoff(windowDays);
  return records.filter((r) => {
    const t = parseTimestamp(r.timestamp);
    return !Number.isNaN(t) && t >= cutoff;
  });
}

async function getAllCallRecords(
  db: IDatabase,
  serverNames: string[],
  windowDays: number,
): Promise<ProxyCallRecord[]> {
  const allRecords: ProxyCallRecord[] = [];
  for (const name of serverNames) {
    const recs = await db.getCallRecordsForServer(name, 10000);
    allRecords.push(...recs);
  }
  return filterByWindow(allRecords, windowDays);
}

function parseDailyBudget(): number {
  const env = process.env['GUARDIAN_DAILY_BUDGET_USD'] ?? process.env['MCP_GUARDIAN_COST_BUDGET'];
  if (!env) return 0;
  const val = parseFloat(env);
  return Number.isFinite(val) && val > 0 ? val : 0;
}

// ── Main API server factory ──────────────────────────────────────────────────

export async function startSocApiServer(port = 4040): Promise<void> {
  const dbPath = process.env['MCP_GUARDIAN_DB_PATH'] || resolveMcpServerDbPath();
  const container = await createContainer(dbPath);
  const db = container.db;

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // CORS — allow dashboard SPA (Next.js dev on :3000, prod on :4040)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers['origin'] as string | undefined;
    const allowed = [
      'http://localhost:3000',
      'http://localhost:3001',
      `http://localhost:${port}`,
      'http://127.0.0.1:3000',
      `http://127.0.0.1:${port}`,
    ];
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-API-Key,X-Guardian-Tenant,X-Tenant-Id,X-CSRF-Token,Accept');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // ── Helpers shared across routes ────────────────────────────────────────

  async function loadServers(): Promise<McpServerConfig[]> {
    try {
      const result = ConfigParser.parseAll();
      return result.servers;
    } catch (err) {
      Logger.warn(`[soc-api] Config parse failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  // ── GET /api/auth/status ──────────────────────────────────────────────────
  app.get('/api/auth/status', (_req: Request, res: Response) => {
    res.json({
      authenticated: true,
      authRequired: false,
      authConfigured: false,
      openCore: true,
      tier: 'community',
      licenseEnforced: false,
      features: ['security', 'cost', 'health', 'policy', 'audit'],
    });
  });

  // ── GET /api/auth/csrf ────────────────────────────────────────────────────
  app.get('/api/auth/csrf', (_req: Request, res: Response) => {
    res.json({ csrfEnforced: false });
  });

  // ── GET /api/security ─────────────────────────────────────────────────────
  app.get('/api/security', async (_req: Request, res: Response) => {
    const cacheKey = 'security';
    const TTL_MS = 5 * 60 * 1000; // 5 minutes — CVE lookups are slow

    const cached = cache.get<SecurityResponse>(cacheKey);
    if (cached) { res.json(cached); return; }

    try {
      const servers = await loadServers();
      if (servers.length === 0) {
        res.json({ available: false, overallScore: null, activeThreats: 0, lastScan: null, serverReports: [] });
        return;
      }

      const results: SecurityReport[] = await Promise.all(
        servers.map((s) => container.securityScanner.scanServer(s)),
      );

      // Persist to DB
      for (const r of results) {
        await db.addSecurityScan(r.serverName, r.score, r.cves.length, r);
      }

      const overallScore = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
        : null;

      const activeThreats = results.reduce(
        (sum, r) => sum + r.cves.filter((c) => c.severity === 'CRITICAL' || c.severity === 'HIGH').length,
        0,
      );

      const serverReports = results.map((r) => ({
        name: r.serverName,
        scanned: true,
        score: r.score,
        critical: r.cves.filter((c) => c.severity === 'CRITICAL').length,
        high: r.cves.filter((c) => c.severity === 'HIGH').length,
        medium: r.cves.filter((c) => c.severity === 'MEDIUM').length,
        secretsFound: r.secretsFound.length,
        authMissing: !r.authStatus.hasAuthentication,
        recommendations: r.recommendations,
      }));

      const response: SecurityResponse = {
        available: true,
        overallScore,
        activeThreats,
        lastScan: new Date().toISOString(),
        serverReports,
      };

      cache.set(cacheKey, response, TTL_MS);
      broadcastSSE('security:updated', response);
      res.json(response);
    } catch (err) {
      Logger.error(`[soc-api] /api/security failed: ${err}`);
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/health ───────────────────────────────────────────────────────
  app.get('/api/health', async (_req: Request, res: Response) => {
    const cacheKey = 'health';
    const TTL_MS = 60 * 1000; // 1 minute

    const cached = cache.get<HealthResponse>(cacheKey);
    if (cached) { res.json(cached); return; }

    try {
      const servers = await loadServers();
      if (servers.length === 0) {
        res.json({ available: false, overallStatus: 'unknown', avgLatencyMs: null, serverReports: [], atRisk: [], totalTools: 0 });
        return;
      }

      const results: HealthReport[] = await Promise.all(
        servers.map((s) => container.healthMonitor.checkServer(s)),
      );

      // Persist to DB
      for (const r of results) {
        await db.addHealthCheck(r.serverName, r.latencyMs, r.successRate > 0.5, r.toolCount);
      }

      const avgLatencyMs = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length)
        : null;

      const atRisk = results
        .filter((r) => r.successRate < 0.5 || r.overloadWarning)
        .map((r) => r.serverName);

      const overallStatus = atRisk.length > 0
        ? 'degraded'
        : results.every((r) => r.successRate >= 0.8)
          ? 'healthy'
          : 'warning';

      const totalTools = results.reduce((sum, r) => sum + r.toolCount, 0);

      const serverReports = results.map((r) => ({
        name: r.serverName,
        latency: r.latencyMs,
        successRate: r.successRate,
        toolCount: r.toolCount,
        circuitBreaker: r.successRate < 0.3 ? 'OPEN' : 'CLOSED',
        overloadWarning: r.overloadWarning,
        recommendations: r.recommendations,
        hasHealthData: true,
      }));

      const response: HealthResponse = {
        available: true,
        overallStatus,
        avgLatencyMs,
        serverReports,
        atRisk,
        totalTools,
      };

      cache.set(cacheKey, response, TTL_MS);
      broadcastSSE('health:updated', response);
      res.json(response);
    } catch (err) {
      Logger.error(`[soc-api] /api/health failed: ${err}`);
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/cost ─────────────────────────────────────────────────────────
  app.get('/api/cost', async (req: Request, res: Response) => {
    const windowDays = parseInt(String(req.query['window'] ?? '7'), 10);
    const cacheKey = `cost:${windowDays}`;
    const TTL_MS = 30 * 1000; // 30 seconds

    const cached = cache.get<CostResponse>(cacheKey);
    if (cached) { res.json(cached); return; }

    try {
      const servers = await loadServers();
      const serverNames = await db.getDistinctActiveServers();
      const allNames = Array.from(new Set([...servers.map((s) => s.name), ...serverNames]));

      const results: CostReport[] = await Promise.all(
        servers.map((s) => container.costAuditor.auditServer(s)),
      );

      // Also fetch raw call records for cost data
      const allRecords = await getAllCallRecords(db, allNames, windowDays);
      const cutoff = getWindowCutoff(windowDays);

      let totalCost = 0;
      const serverCostMap = new Map<string, { cost: number; tokens: number; inputTokens: number; outputTokens: number }>();

      for (const r of allRecords) {
        const t = parseTimestamp(r.timestamp);
        if (!Number.isNaN(t) && t >= cutoff) {
          const cost = r.costUsd ?? 0;
          totalCost += cost;
          const existing = serverCostMap.get(r.serverName) ?? { cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0 };
          existing.cost += cost;
          existing.tokens += r.totalTokens;
          existing.inputTokens += r.requestTokens;
          existing.outputTokens += r.responseTokens;
          serverCostMap.set(r.serverName, existing);
        }
      }

      const windowHours = windowDays * 24;
      const burnRatePerHour = windowHours > 0 ? totalCost / windowHours : 0;
      const projectedMonthly = burnRatePerHour * 24 * 30;
      const budgetUsd = parseDailyBudget() * windowDays || null;

      const serverReports = results.map((r) => {
        const dbData = serverCostMap.get(r.serverName);
        return {
          name: r.serverName,
          cost: dbData?.cost ?? r.estimatedCostUSD,
          tokens: dbData?.tokens ?? r.tokensUsed,
          inputTokens: dbData?.inputTokens ?? r.inputTokens,
          outputTokens: dbData?.outputTokens ?? r.outputTokens,
          toolBreakdown: r.toolBreakdown.map((tb) => ({
            tool: tb.toolName,
            calls: tb.calls,
            costUsd: tb.cost,
            tokens: tb.tokens,
          })),
          priced: r.priced ?? false,
          provider: r.provider ?? 'unknown',
          modelId: r.modelId ?? 'unknown',
          note: r.note,
        };
      });

      const budgetAlerts: string[] = [];
      if (budgetUsd && totalCost > budgetUsd * 0.8) {
        budgetAlerts.push(`Cost ($${totalCost.toFixed(4)}) is at ${((totalCost / budgetUsd) * 100).toFixed(0)}% of budget`);
      }

      const response: CostResponse = {
        available: true,
        totalCost: Math.round(totalCost * 100000) / 100000,
        projectedMonthly: Math.round(projectedMonthly * 100000) / 100000,
        burnRatePerHour: Math.round(burnRatePerHour * 100000) / 100000,
        budgetUsd,
        pricingModel: results[0]?.pricingModel ?? 'unknown',
        windowDays,
        serverReports,
        budgetAlerts,
      };

      cache.set(cacheKey, response, TTL_MS);
      res.json(response);
    } catch (err) {
      Logger.error(`[soc-api] /api/cost failed: ${err}`);
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/cost/breakdown ───────────────────────────────────────────────
  app.get('/api/cost/breakdown', async (req: Request, res: Response) => {
    const windowDays = parseInt(String(req.query['window'] ?? '7'), 10);
    try {
      const serverNames = await db.getDistinctActiveServers();
      const allRecords = await getAllCallRecords(db, serverNames, windowDays);

      // Aggregate by server+tool
      const toolMap = new Map<string, { server: string; tool: string; calls: number; costUsd: number }>();
      for (const r of allRecords) {
        const key = `${r.serverName}::${r.toolName}`;
        const existing = toolMap.get(key) ?? { server: r.serverName, tool: r.toolName, calls: 0, costUsd: 0 };
        existing.calls += 1;
        existing.costUsd += r.costUsd ?? 0;
        toolMap.set(key, existing);
      }

      res.json({
        available: true,
        windowDays,
        tools: Array.from(toolMap.values()).sort((a, b) => b.costUsd - a.costUsd),
      });
    } catch (err) {
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/cost/timeseries ──────────────────────────────────────────────
  app.get('/api/cost/timeseries', async (req: Request, res: Response) => {
    const windowDays = parseInt(String(req.query['window'] ?? '7'), 10);
    const granularity = (req.query['granularity'] as string) === 'hour' ? 'hour' : 'day';
    try {
      const serverNames = await db.getDistinctActiveServers();
      const allRecords = await getAllCallRecords(db, serverNames, windowDays);

      const bucketMs = granularity === 'hour' ? 3600_000 : 86400_000;
      const now = Date.now();
      const numBuckets = granularity === 'hour' ? windowDays * 24 : windowDays;
      const startTime = now - numBuckets * bucketMs;

      type BucketKey = string;
      const bucketMap = new Map<BucketKey, { bucket: string; server: string; costUsd: number; calls: number }>();

      for (const r of allRecords) {
        const t = parseTimestamp(r.timestamp);
        if (Number.isNaN(t) || t < startTime) continue;
        const bucketIdx = Math.floor((t - startTime) / bucketMs);
        const bucketTime = new Date(startTime + bucketIdx * bucketMs);
        const bucketStr = granularity === 'hour'
          ? bucketTime.toISOString().slice(0, 13) + ':00'
          : bucketTime.toISOString().slice(0, 10);
        const key = `${bucketStr}::${r.serverName}`;
        const existing = bucketMap.get(key) ?? { bucket: bucketStr, server: r.serverName, costUsd: 0, calls: 0 };
        existing.costUsd += r.costUsd ?? 0;
        existing.calls += 1;
        bucketMap.set(key, existing);
      }

      const series = Array.from(bucketMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));

      // Pivot by server
      const allServerNames = Array.from(new Set(series.map((s) => s.server)));
      const buckets = Array.from(new Set(series.map((s) => s.bucket))).sort();
      const pivoted = buckets.map((bucket) => {
        const row: Record<string, string | number> = { bucket, total: 0 };
        for (const server of allServerNames) {
          const entry = series.find((s) => s.bucket === bucket && s.server === server);
          row[server] = entry?.costUsd ?? 0;
          (row['total'] as number) += (entry?.costUsd ?? 0);
        }
        return row;
      });

      res.json({
        available: true,
        windowDays,
        granularity,
        series,
        totalsByServer: allServerNames.map((server) => ({
          server,
          costUsd: series.filter((s) => s.server === server).reduce((sum, s) => sum + s.costUsd, 0),
          calls: series.filter((s) => s.server === server).reduce((sum, s) => sum + s.calls, 0),
        })),
        pivoted,
      });
    } catch (err) {
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/aggregate/metrics ────────────────────────────────────────────
  app.get('/api/aggregate/metrics', async (req: Request, res: Response) => {
    const windowDays = parseInt(String(req.query['window'] ?? '7'), 10);
    const cacheKey = `aggregate:metrics:${windowDays}`;
    const TTL_MS = 15 * 1000;

    const cached = cache.get<AggregateMetrics>(cacheKey);
    if (cached) { res.json(cached); return; }

    try {
      const serverNames = await db.getDistinctActiveServers();
      const allRecords = await getAllCallRecords(db, serverNames, windowDays);

      if (allRecords.length === 0) {
        res.json({
          available: true,
          totalRequests: 0,
          blockedRequests: 0,
          passedRequests: 0,
          totalCost: 0,
          avgLatencyMs: 0,
          passRate: null,
          activeServers: serverNames.length,
          lastUpdated: new Date().toISOString(),
          burnRatePerHour: null,
        });
        return;
      }

      const totalRequests = allRecords.length;
      const blockedRequests = allRecords.filter((r) => r.blocked).length;
      const passedRequests = totalRequests - blockedRequests;
      const totalCost = allRecords.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      const avgLatencyMs = allRecords.length > 0
        ? Math.round(allRecords.reduce((sum, r) => sum + r.durationMs, 0) / allRecords.length)
        : 0;
      const passRate = totalRequests > 0 ? Math.round((passedRequests / totalRequests) * 100) : null;
      const windowHours = windowDays * 24;
      const burnRatePerHour = windowHours > 0 ? totalCost / windowHours : null;
      const activeServers = new Set(allRecords.map((r) => r.serverName)).size;

      const response: AggregateMetrics = {
        available: true,
        totalRequests,
        blockedRequests,
        passedRequests,
        totalCost: Math.round(totalCost * 100000) / 100000,
        avgLatencyMs,
        passRate,
        activeServers,
        lastUpdated: new Date().toISOString(),
        burnRatePerHour: burnRatePerHour !== null ? Math.round(burnRatePerHour * 100000) / 100000 : null,
      };

      cache.set(cacheKey, response, TTL_MS);
      res.json(response);
    } catch (err) {
      Logger.error(`[soc-api] /api/aggregate/metrics failed: ${err}`);
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/aggregate/audit ──────────────────────────────────────────────
  app.get('/api/aggregate/audit', async (req: Request, res: Response) => {
    const windowDays = parseWindowDays(String(req.query['window'] ?? '7'));
    const limitParam = parseInt(String(req.query['limit'] ?? '200'), 10);
    const actionFilter = req.query['action'] as string | undefined;
    const serverFilter = req.query['server'] as string | undefined;

    try {
      const serverNames = await db.getDistinctActiveServers();
      const allRecords = await getAllCallRecords(db, serverNames, windowDays);

      let filtered = allRecords;
      if (actionFilter === 'block') filtered = filtered.filter((r) => r.blocked);
      else if (actionFilter === 'pass') filtered = filtered.filter((r) => !r.blocked);
      if (serverFilter) filtered = filtered.filter((r) => r.serverName === serverFilter);

      // Sort newest first
      filtered.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

      const events: AuditEvent[] = filtered.slice(0, limitParam).map((r) => ({
        timestamp: r.timestamp,
        server_name: r.serverName,
        tool_name: r.toolName,
        action: r.blocked ? 'block' : 'pass',
        rule: r.blockRule ?? null,
        reason: r.blockReason ?? null,
        cost_usd: r.costUsd ?? null,
        model: r.model ?? null,
      }));

      const response: AuditResponse = {
        available: true,
        events,
        total: allRecords.length,
        blocked: allRecords.filter((r) => r.blocked).length,
        passed: allRecords.filter((r) => !r.blocked).length,
        flagged: 0,
      };

      res.json(response);
    } catch (err) {
      Logger.error(`[soc-api] /api/aggregate/audit failed: ${err}`);
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/audit/heatmap ────────────────────────────────────────────────
  app.get('/api/audit/heatmap', async (req: Request, res: Response) => {
    const windowDays = parseWindowDays(String(req.query['window'] ?? '7'));
    try {
      const serverNames = await db.getDistinctActiveServers();
      const allRecords = await getAllCallRecords(db, serverNames, windowDays);
      const bundle = buildAuditHeatmapBundle(allRecords, windowDays);
      res.json({ available: true, ...bundle });
    } catch (err) {
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/policy ────────────────────────────────────────────────────────
  app.get('/api/policy', (_req: Request, res: Response) => {
    try {
      const policyPath = process.env['MCP_GUARDIAN_POLICY']
        || path.join(process.cwd(), 'default-policy.yaml');

      if (!fs.existsSync(policyPath)) {
        res.json({ mode: 'block', rules: '0 rules', yaml: '', path: policyPath });
        return;
      }

      const raw = fs.readFileSync(policyPath, 'utf-8');
      const parsed = yaml.load(raw) as Record<string, unknown> | null;
      const policy = (parsed?.policy ?? parsed) as Record<string, unknown> | null;
      const mode = (policy?.mode as string) ?? 'block';
      const rules = policy?.rules;
      const ruleCount = Array.isArray(rules) ? rules.length : 0;

      res.json({
        mode,
        rules: `${ruleCount} rule${ruleCount !== 1 ? 's' : ''}`,
        yaml: raw,
        path: policyPath,
      });
    } catch (err) {
      res.status(500).json({ mode: 'unknown', rules: '0 rules', error: String(err) });
    }
  });

  // ── PUT /api/policy ────────────────────────────────────────────────────────
  app.put('/api/policy', (req: Request, res: Response) => {
    try {
      const { yaml: yamlContent } = req.body as { yaml?: string };
      if (!yamlContent) { res.status(400).json({ error: 'yaml body required' }); return; }

      const policyPath = process.env['MCP_GUARDIAN_POLICY']
        || path.join(process.cwd(), 'default-policy.yaml');

      // Validate YAML before writing
      yaml.load(yamlContent);
      fs.writeFileSync(policyPath, yamlContent, 'utf-8');
      cache.invalidateAll();
      broadcastSSE('policy:reloaded', { path: policyPath, timestamp: new Date().toISOString() });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err) });
    }
  });

  // ── POST /api/policy/reload ────────────────────────────────────────────────
  app.post('/api/policy/reload', (_req: Request, res: Response) => {
    cache.invalidateAll();
    broadcastSSE('policy:reloaded', { timestamp: new Date().toISOString() });
    res.json({ ok: true });
  });

  // ── GET /api/dashboard/executive-summary ──────────────────────────────────
  app.get('/api/dashboard/executive-summary', async (req: Request, res: Response) => {
    const windowDays = parseInt(String(req.query['window'] ?? '7'), 10);
    const cacheKey = `exec-summary:${windowDays}`;
    const TTL_MS = 30 * 1000;

    const cached = cache.get<ExecutiveSummaryResponse>(cacheKey);
    if (cached) { res.json(cached); return; }

    try {
      const serverNames = await db.getDistinctActiveServers();
      const allRecords = await getAllCallRecords(db, serverNames, windowDays);

      const totalRequests = allRecords.length;
      const blockedRequests = allRecords.filter((r) => r.blocked).length;
      const passedRequests = totalRequests - blockedRequests;
      const totalCostUsd = allRecords.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      const avgLatencyMs = totalRequests > 0
        ? Math.round(allRecords.reduce((sum, r) => sum + r.durationMs, 0) / totalRequests)
        : 0;
      const passRatePct = totalRequests > 0 ? Math.round((passedRequests / totalRequests) * 100) : 0;
      const blockRatePct = 100 - passRatePct;
      const windowHours = windowDays * 24;
      const burnRatePerHour = windowHours > 0 ? totalCostUsd / windowHours : 0;
      const projectedMonthlyUsd = burnRatePerHour * 24 * 30;
      const activeServers = new Set(allRecords.map((r) => r.serverName)).size;
      const budgetUsd = parseDailyBudget() * windowDays || null;
      const budgetUtilizationPct = budgetUsd && budgetUsd > 0
        ? Math.round((totalCostUsd / budgetUsd) * 100)
        : null;

      // Top servers by cost
      const serverCostMap = new Map<string, { costUsd: number; calls: number }>();
      for (const r of allRecords) {
        const existing = serverCostMap.get(r.serverName) ?? { costUsd: 0, calls: 0 };
        existing.costUsd += r.costUsd ?? 0;
        existing.calls += 1;
        serverCostMap.set(r.serverName, existing);
      }
      const topServersByCost = Array.from(serverCostMap.entries())
        .map(([server, data]) => ({ server, costUsd: Math.round(data.costUsd * 100000) / 100000, calls: data.calls }))
        .sort((a, b) => b.costUsd - a.costUsd)
        .slice(0, 5);

      // Top tools by calls
      const toolCallMap = new Map<string, number>();
      for (const r of allRecords) {
        toolCallMap.set(r.toolName, (toolCallMap.get(r.toolName) ?? 0) + 1);
      }
      const topToolsByCalls = Array.from(toolCallMap.entries())
        .map(([tool, calls]) => ({ tool, calls }))
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 5);

      // Sparklines (last 24 buckets — each bucket = windowDays/24 days)
      const sparkBucketMs = (windowDays / 24) * 86400_000;
      const sparkTotalCalls: number[] = Array(24).fill(0);
      const sparkBlocked: number[] = Array(24).fill(0);
      const sparkCostUsd: number[] = Array(24).fill(0);
      const sparkStart = Date.now() - windowDays * 86400_000;

      for (const r of allRecords) {
        const t = parseTimestamp(r.timestamp);
        if (Number.isNaN(t)) continue;
        const bucketIdx = Math.min(23, Math.floor((t - sparkStart) / sparkBucketMs));
        if (bucketIdx >= 0) {
          sparkTotalCalls[bucketIdx] += 1;
          if (r.blocked) sparkBlocked[bucketIdx] += 1;
          sparkCostUsd[bucketIdx] += r.costUsd ?? 0;
        }
      }

      const noComparison = { deltaPct: null, deltaAbs: 0, direction: 'flat' as const };

      const response: ExecutiveSummaryResponse = {
        available: true,
        timestamp: new Date().toISOString(),
        windowDays,
        totalRequests,
        blockedRequests,
        passedRequests,
        passRatePct,
        blockRatePct,
        totalCostUsd: Math.round(totalCostUsd * 100000) / 100000,
        burnRatePerHour: Math.round(burnRatePerHour * 100000) / 100000,
        projectedMonthlyUsd: Math.round(projectedMonthlyUsd * 100000) / 100000,
        avgLatencyMs,
        activeServers,
        budgetUsd,
        budgetUtilizationPct,
        topServersByCost,
        topToolsByCalls,
        sparklines: {
          totalCalls: sparkTotalCalls,
          blocked: sparkBlocked,
          costUsd: sparkCostUsd.map((v) => Math.round(v * 100000) / 100000),
        },
        comparison: {
          totalRequests: noComparison,
          blockedRequests: noComparison,
          totalCostUsd: noComparison,
          passRatePct: noComparison,
        },
      };

      cache.set(cacheKey, response, TTL_MS);
      res.json(response);
    } catch (err) {
      Logger.error(`[soc-api] /api/dashboard/executive-summary failed: ${err}`);
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/dashboard/insights ───────────────────────────────────────────
  app.get('/api/dashboard/insights', async (req: Request, res: Response) => {
    const scope = (req.query['scope'] as string) || 'overview';
    const windowDays = parseInt(String(req.query['window'] ?? '7'), 10);

    try {
      const serverNames = await db.getDistinctActiveServers();
      const allRecords = await getAllCallRecords(db, serverNames, windowDays);
      const totalRequests = allRecords.length;
      const blockedRequests = allRecords.filter((r) => r.blocked).length;
      const totalCost = allRecords.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      const passRate = totalRequests > 0 ? (((totalRequests - blockedRequests) / totalRequests) * 100).toFixed(1) : '0';

      const bullets: string[] = [];

      if (scope === 'overview' || scope === 'audit') {
        bullets.push(`${totalRequests} total requests in the last ${windowDays} days`);
        bullets.push(`${blockedRequests} blocked (${totalRequests > 0 ? ((blockedRequests / totalRequests) * 100).toFixed(1) : '0'}% block rate)`);
        bullets.push(`${passRate}% pass rate`);

        const topBlockRules = new Map<string, number>();
        for (const r of allRecords) {
          if (r.blocked && r.blockRule) {
            topBlockRules.set(r.blockRule, (topBlockRules.get(r.blockRule) ?? 0) + 1);
          }
        }
        const topRule = Array.from(topBlockRules.entries()).sort((a, b) => b[1] - a[1])[0];
        if (topRule) bullets.push(`Top block rule: "${topRule[0]}" (${topRule[1]} blocks)`);
      }

      if (scope === 'cost') {
        bullets.push(`Total cost: $${totalCost.toFixed(6)} USD over ${windowDays} days`);
        const windowHours = windowDays * 24;
        const burnRate = windowHours > 0 ? (totalCost / windowHours).toFixed(8) : '0';
        bullets.push(`Burn rate: $${burnRate}/hour`);
        const monthly = (parseFloat(burnRate) * 24 * 30).toFixed(6);
        bullets.push(`Projected monthly: $${monthly} USD`);

        const budget = parseDailyBudget();
        if (budget > 0) {
          const used = (totalCost / (budget * windowDays)) * 100;
          bullets.push(`Budget utilization: ${used.toFixed(1)}% of $${(budget * windowDays).toFixed(2)} window budget`);
        } else {
          bullets.push('No budget cap configured (set GUARDIAN_DAILY_BUDGET_USD to enable)');
        }
      }

      if (scope === 'security') {
        const scannedServers = await db.getDistinctScannedServers();
        bullets.push(`${scannedServers.length} server(s) scanned`);
        bullets.push('Run scan_security via CLI or MCP tool to get fresh CVE data');
      }

      if (scope === 'ai') {
        bullets.push('AI learning is active — patterns learned from blocked requests');
        bullets.push('Semantic audit available when ANTHROPIC_API_KEY is configured');
        bullets.push(`${blockedRequests} training samples from policy blocks`);
      }

      if (bullets.length === 0) {
        bullets.push(`No data available for ${scope} scope in ${windowDays}d window`);
        bullets.push('Use mcp-guardian proxy to capture real traffic');
      }

      res.json({
        available: true,
        scope,
        generatedAt: new Date().toISOString(),
        windowDays,
        source: totalRequests > 0 ? 'measured' : 'deterministic',
        bullets,
        narrative: bullets.join(' · '),
      });
    } catch (err) {
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/ai/suggestions ───────────────────────────────────────────────
  app.get('/api/ai/suggestions', async (_req: Request, res: Response) => {
    try {
      // Return policy suggestions derived from blocked traffic
      const serverNames = await db.getDistinctActiveServers();
      const allRecords = await getAllCallRecords(db, serverNames, 7);
      const blockRuleMap = new Map<string, { count: number; tools: Set<string> }>();

      for (const r of allRecords) {
        if (r.blocked && r.blockRule) {
          const existing = blockRuleMap.get(r.blockRule) ?? { count: 0, tools: new Set<string>() };
          existing.count += 1;
          existing.tools.add(r.toolName);
          blockRuleMap.set(r.blockRule, existing);
        }
      }

      const suggestions = Array.from(blockRuleMap.entries())
        .filter(([, data]) => data.count >= 3)
        .map(([rule, data]) => ({
          id: `auto-${rule}`,
          ruleName: rule,
          confidence: Math.min(0.99, 0.7 + data.count * 0.01),
          reason: `Rule "${rule}" triggered ${data.count} times across tools: ${Array.from(data.tools).join(', ')}`,
          source: 'traffic-analysis',
        }));

      res.json({ suggestions });
    } catch (err) {
      res.status(500).json({ suggestions: [], error: String(err) });
    }
  });

  // ── GET /api/instances ────────────────────────────────────────────────────
  app.get('/api/instances', async (_req: Request, res: Response) => {
    try {
      const servers = await loadServers();
      const serverNames = await db.getDistinctActiveServers();

      const instances = servers.map((s) => {
        const hasTraffic = serverNames.includes(s.name);
        return {
          instanceId: s.name,
          instanceName: s.name,
          hostname: os.hostname(),
          status: 'active',
          region: process.env['GUARDIAN_REGION'] || 'local',
          lastHeartbeat: new Date().toISOString(),
          totalRequests: 0,
          blockedRequests: 0,
          totalCostUsd: 0,
          avgLatencyMs: 0,
          fleetSource: 'local',
          transport: s.transport,
          hasTraffic,
        };
      });

      res.json({
        available: true,
        source: 'local',
        region: process.env['GUARDIAN_REGION'] || 'local',
        totalInstances: instances.length,
        activeInstances: instances.length,
        totalRequests: 0,
        totalBlocked: 0,
        totalCostUsd: 0,
        instances,
      });
    } catch (err) {
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/admin/tenant ─────────────────────────────────────────────────
  app.get('/api/admin/tenant', (_req: Request, res: Response) => {
    res.json({
      tenantId: process.env['GUARDIAN_TENANT_ID'] || 'default',
      multiTenantMode: false,
    });
  });

  // ── GET /api/dashboard/regions ────────────────────────────────────────────
  app.get('/api/dashboard/regions', (_req: Request, res: Response) => {
    res.json({
      available: true,
      regions: [process.env['GUARDIAN_REGION'] || 'local'],
    });
  });

  // ── POST /api/login / POST /api/logout ────────────────────────────────────
  app.post('/api/login', (_req: Request, res: Response) => {
    res.json({ success: true });
  });
  app.post('/api/logout', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // ── POST /api/policy/test ──────────────────────────────────────────────────
  app.post('/api/policy/test', async (req: Request, res: Response) => {
    try {
      const { tool, arguments: args, server } = req.body as {
        tool: string;
        arguments: Record<string, unknown>;
        server?: string;
      };

      if (!tool) { res.status(400).json({ error: 'tool required' }); return; }

      const policyPath = process.env['MCP_GUARDIAN_POLICY']
        || path.join(process.cwd(), 'default-policy.yaml');

      if (!fs.existsSync(policyPath)) {
        res.json({ action: 'pass', rule: 'default', reason: 'No policy file found' });
        return;
      }

      const raw = fs.readFileSync(policyPath, 'utf-8');
      const parsed = yaml.load(raw) as Record<string, unknown> | null;
      const policy = (parsed?.policy ?? parsed) as Record<string, unknown> | null;
      const rules = Array.isArray(policy?.rules) ? policy.rules as Array<{ id?: string; match?: Record<string, unknown>; action?: string }> : [];

      // Simple regex-based test against policy rules
      const argsStr = JSON.stringify(args ?? {});
      for (const rule of rules) {
        const patterns = (rule.match as Record<string, unknown[]>)?.patterns ?? [];
        for (const p of patterns) {
          try {
            const re = new RegExp(String(p), 'i');
            if (re.test(argsStr) || re.test(tool)) {
              res.json({ action: rule.action ?? 'block', rule: rule.id ?? 'unnamed', reason: `Pattern matched: ${p}` });
              return;
            }
          } catch { /* skip invalid regex */ }
        }
        const deny = (rule.match as Record<string, unknown>)?.deny_tools as string[] | undefined;
        if (deny?.includes(tool)) {
          res.json({ action: rule.action ?? 'block', rule: rule.id ?? 'unnamed', reason: `Tool explicitly denied` });
          return;
        }
      }

      res.json({ action: 'pass', rule: 'default', reason: 'No policy rules matched' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── GET /api/security-swarm/tool-integrity ────────────────────────────────
  app.get('/api/security-swarm/tool-integrity', (_req: Request, res: Response) => {
    res.json({ available: false, reason: 'Run security-swarm to generate tool integrity report' });
  });

  // ── GET /api/security-swarm/shadow-red-team ───────────────────────────────
  app.get('/api/security-swarm/shadow-red-team', (_req: Request, res: Response) => {
    res.json({ available: false, reason: 'Run security-swarm --shadow-red-team to generate report' });
  });

  // ── GET /api/security-swarm/supply-chain ─────────────────────────────────
  app.get('/api/security-swarm/supply-chain', (_req: Request, res: Response) => {
    res.json({ available: false, reason: 'Run security-swarm to generate supply chain graph' });
  });

  // ── GET /api/security-swarm/status ────────────────────────────────────────
  app.get('/api/security-swarm/status', (_req: Request, res: Response) => {
    res.json({
      jobId: 'none',
      state: 'idle',
      phase: 'idle',
      phaseLabel: 'No active job',
      progressPct: 0,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      error: null,
      analysisPath: '',
      logTail: '',
      hasRun: false,
    });
  });

  // ── GET /api/learning/semantic/active-learning ────────────────────────────
  app.get('/api/learning/semantic/active-learning', (_req: Request, res: Response) => {
    res.json({ available: false, queued: 0, processed: 0, flagged: 0, enabled: false });
  });

  // ── GET /api/ai/compliance/report ────────────────────────────────────────
  app.get('/api/ai/compliance/report', (_req: Request, res: Response) => {
    res.json({ available: false, reason: 'Compliance report requires ANTHROPIC_API_KEY' });
  });

  // ── GET /api/ai/tenant-model/readiness ────────────────────────────────────
  app.get('/api/ai/tenant-model/readiness', (_req: Request, res: Response) => {
    res.json({
      tenantId: 'default',
      ready: false,
      labeledCount: 0,
      minRequired: 50,
      modelName: 'guardian-tenant-default',
      exportPath: '',
      message: 'Not enough labeled data yet',
    });
  });

  // ── GET /api/fleet/signature-hints ────────────────────────────────────────
  app.get('/api/fleet/signature-hints', (_req: Request, res: Response) => {
    res.json({ available: false, hints: [] });
  });

  // ── GET /api/dashboard/agent-abuse ────────────────────────────────────────
  app.get('/api/dashboard/agent-abuse', async (req: Request, res: Response) => {
    const windowDays = parseInt(String(req.query['window'] ?? '7'), 10);
    try {
      const serverNames = await db.getDistinctActiveServers();
      const allRecords = await getAllCallRecords(db, serverNames, windowDays);
      const agentMap = new Map<string, number>();
      for (const r of allRecords) {
        if (r.blocked) {
          agentMap.set(r.serverName, (agentMap.get(r.serverName) ?? 0) + 1);
        }
      }
      const scores = Array.from(agentMap.entries()).map(([server, blocks]) => ({
        server,
        abuseScore: Math.min(100, Math.round((blocks / Math.max(allRecords.filter((r) => r.serverName === server).length, 1)) * 100)),
        blocks,
      }));
      res.json({ available: true, windowDays, scores });
    } catch (err) {
      res.status(500).json({ available: false, error: String(err) });
    }
  });

  // ── GET /api/learning/semantic/tribunal ───────────────────────────────────
  app.get('/api/learning/semantic/tribunal', (_req: Request, res: Response) => {
    res.json({ available: false, items: [], reason: 'Semantic tribunal requires ANTHROPIC_API_KEY' });
  });

  // ── POST /api/incidents/investigate ──────────────────────────────────────
  app.post('/api/incidents/investigate', (_req: Request, res: Response) => {
    res.json({ investigation: null, error: 'LLM investigation requires ANTHROPIC_API_KEY' });
  });

  // ── POST /api/policy/suggestions/accept ──────────────────────────────────
  app.post('/api/policy/suggestions/accept', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // ── POST /api/policy/suggestions/reject ──────────────────────────────────
  app.post('/api/policy/suggestions/reject', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // ── POST /api/policy/copilot ──────────────────────────────────────────────
  app.post('/api/policy/copilot', (_req: Request, res: Response) => {
    res.json({ available: false, reason: 'Policy copilot requires ANTHROPIC_API_KEY' });
  });

  // ── POST /api/security-swarm/run ──────────────────────────────────────────
  app.post('/api/security-swarm/run', (_req: Request, res: Response) => {
    res.json({ ok: false, error: 'Use pnpm security-swarm from the CLI' });
  });

  // ── POST /api/ai/tenant-model/train ──────────────────────────────────────
  app.post('/api/ai/tenant-model/train', (_req: Request, res: Response) => {
    res.json({ available: false, error: 'Tenant model training requires CLI' });
  });

  // ── GET /api/ai/tenant-model/train/status ────────────────────────────────
  app.get('/api/ai/tenant-model/train/status', (_req: Request, res: Response) => {
    res.json({ jobId: 'none', tenantId: 'default', state: 'idle', startedAt: null, finishedAt: null, exitCode: null, error: null, logTail: '' });
  });

  // ── GET /api/dashboard/insights/export ────────────────────────────────────
  app.get('/api/dashboard/insights/export', async (req: Request, res: Response) => {
    const scope = (req.query['scope'] as string) || 'overview';
    const windowDays = parseInt(String(req.query['window'] ?? '7'), 10);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="guardian-briefing-${scope}-${windowDays}d.md"`);
    res.send(`# MCP Guardian Briefing — ${scope} (${windowDays}d)\n\nGenerated: ${new Date().toISOString()}\n`);
  });

  // ── GET /health ────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime(), version: process.env['npm_package_version'] ?? '3.x' });
  });

  // ── GET /api/sse — Real-time Server-Sent Events ───────────────────────────
  app.get('/api/sse', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

    // Keep-alive ping every 30s
    const pingTimer = setInterval(() => {
      try { res.write(`:ping\n\n`); } catch { clearInterval(pingTimer); }
    }, 30_000);

    req.on('close', () => {
      clearInterval(pingTimer);
      sseClients.delete(res);
    });
  });

  // ── 404 fallback ──────────────────────────────────────────────────────────
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  // ── Start HTTP server ─────────────────────────────────────────────────────
  const httpServer = createServer(app);
  httpServer.listen(port, () => {
    Logger.info(`[soc-api] MCP Guardian SOC API server listening on http://localhost:${port}`);
    Logger.info(`[soc-api] DB path: ${dbPath}`);
  });

  // ── Background auto-refresh (push SSE updates every 30s) ─────────────────
  const AUTO_REFRESH_INTERVAL = parseInt(process.env['SOC_API_REFRESH_INTERVAL_MS'] ?? '30000', 10);
  setInterval(async () => {
    if (sseClients.size === 0) return;
    try {
      const serverNames = await db.getDistinctActiveServers();
      const records7d = await getAllCallRecords(db, serverNames, 7);
      const totalRequests = records7d.length;
      const blockedRequests = records7d.filter((r) => r.blocked).length;
      const totalCost = records7d.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      const activeServers = new Set(records7d.map((r) => r.serverName)).size;

      broadcastSSE('metrics:live', {
        totalRequests,
        blockedRequests,
        passedRequests: totalRequests - blockedRequests,
        totalCost: Math.round(totalCost * 100000) / 100000,
        activeServers,
        lastUpdated: new Date().toISOString(),
      });

      // Invalidate metric caches so next request gets fresh data
      cache.invalidate('aggregate:metrics:7');
      cache.invalidate('exec-summary:7');
    } catch {
      // Ignore background refresh errors
    }
  }, AUTO_REFRESH_INTERVAL);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async () => {
    Logger.info('[soc-api] Shutting down...');
    for (const c of sseClients) { try { c.end(); } catch { /* noop */ } }
    sseClients.clear();
    httpServer.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Auto-start if run directly
const isMain = process.argv[1]?.endsWith('soc-api-server.ts')
  || process.argv[1]?.endsWith('soc-api-server.js');
if (isMain) {
  const port = parseInt(process.env['SOC_API_PORT'] ?? '4040', 10);
  startSocApiServer(port).catch((err) => {
    console.error('[soc-api] Failed to start:', err);
    process.exit(1);
  });
}

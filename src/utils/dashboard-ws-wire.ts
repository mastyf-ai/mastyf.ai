/**
 * Wire WebSocket data providers to history DB + AI engine for live dashboard push.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WsBroadcaster } from '../dashboard/ws-broadcaster.js';
import {
  getAllActiveServerNames,
  loadAllCallRecords,
  summarizeRecords,
} from './db-aggregate.js';
import { getEffectiveSwarmDir } from '../tenant/swarm-tenant-paths.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { getTraceLogFields } from './tracing.js';
import { resolveAiPendingSuggestionsPath } from '../ai/ai-paths.js';
import { getAiEngine } from '../ai/suggestion-engine.js';
import { getRecentLogEntries } from './dashboard-log-writer.js';

let wiredDb: unknown = null;

export function wireDashboardWsProviders(ws: WsBroadcaster | null, historyDb: unknown): void {
  if (!ws || !historyDb) return;
  wiredDb = historyDb;
  const db = historyDb as Parameters<typeof loadAllCallRecords>[0];

  ws.setDataProviders({
    auditTrail: async (tenantId: string) => {
      try {
        const srvs = await getAllActiveServerNames(db, tenantId);
        const records = await loadAllCallRecords(db, srvs, tenantId);
        const sorted = [...records].sort((a, b) =>
          (b.timestamp || '').localeCompare(a.timestamp || ''),
        );
        return sorted.slice(0, 50).map((r) => ({
          timestamp: r.timestamp,
          server_name: r.serverName,
          tool_name: r.toolName,
          action: r.blocked ? 'block' : 'pass',
          rule: r.blockRule,
          reason: r.blockReason,
          cost_usd: r.costUsd,
        }));
      } catch {
        return [];
      }
    },
    metrics: async (tenantId: string) => {
      try {
        const srvs = await getAllActiveServerNames(db, tenantId);
        const records = await loadAllCallRecords(db, srvs, tenantId);
        const sum = summarizeRecords(records);
        const avgLatency = sum.total > 0 ? Math.round(sum.totalLatency / sum.total) : 0;
        const passRate = sum.total > 0 ? Math.round((sum.passed / sum.total) * 100) : 100;
        return {
          totalRequests: sum.total,
          blockedRequests: sum.blocked,
          passedRequests: sum.passed,
          totalCost: sum.costUsd,
          avgLatencyMs: avgLatency,
          passRate,
          activeServers: srvs.length,
          burnRatePerHour: sum.total > 0 ? (sum.costUsd / sum.total) * 100 : 0,
          lastUpdated: new Date().toISOString(),
          ...getTraceLogFields(),
        };
      } catch {
        return null;
      }
    },
    suggestions: (tenantId: string) => {
      try {
        const path = resolveAiPendingSuggestionsPath(tenantId);
        if (existsSync(path)) {
          const body = JSON.parse(readFileSync(path, 'utf-8')) as { suggestions?: unknown[] };
          return body.suggestions || [];
        }
      } catch {
        /* fall through */
      }
      return [];
    },
    aiState: (_tenantId: string) => {
      try {
        return getAiEngine()?.getSelfImprovement()?.getState() ?? null;
      } catch {
        return null;
      }
    },
    baselines: (_tenantId: string) => {
      try {
        return getAiEngine()?.getBaselineLearner()?.getAllBaselines() ?? [];
      } catch {
        return [];
      }
    },
    logs: (tenantId: string) => {
      try {
        return getRecentLogEntries(tenantId || DEFAULT_TENANT_ID, 40).map(e =>
          `[${e.timestamp}] [${e.level.toUpperCase()}] [${e.category}]${e.source ? ` [${e.source}]` : ''} ${e.message}${e.details ? ` — ${e.details}` : ''}`,
        );
      } catch {
        const lines: string[] = [];
        const jobLog = join(getEffectiveSwarmDir(tenantId || DEFAULT_TENANT_ID), 'job.log');
        if (existsSync(jobLog)) {
          const tail = readFileSync(jobLog, 'utf-8').split('\n').filter(Boolean).slice(-40);
          lines.push(...tail.map((l) => `[swarm] ${l}`));
        }
        return lines;
      }
    },
  });
}

export function getWiredDashboardDb(): unknown {
  return wiredDb;
}

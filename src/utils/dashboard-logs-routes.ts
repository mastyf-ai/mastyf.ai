import { IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadLogEntries, clearLogFiles, type LogEntry } from './dashboard-log-writer.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface RouteParams {
  url: string;
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  requestTenantId: string;
  writeJson: (res: ServerResponse, status: number, body: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  setCors: () => void;
  runtimeHistoryDb?: any;
}

const CATEGORIES = [
  'user_activity', 'security', 'deployment', 'system', 'error',
  'warning', 'debug', 'swarm', 'api_request', 'policy_decision', 'auth', 'plugin',
];

const LEVELS = ['debug', 'info', 'warn', 'error', 'critical'];

async function loadSwarmLogs(tenantId: string): Promise<LogEntry[]> {
  try {
    const { getEffectiveSwarmDir } = await import('../tenant/swarm-tenant-paths.js');
    const jobLog = join(getEffectiveSwarmDir(tenantId), 'job.log');
    if (!existsSync(jobLog)) return [];
    const lines = readFileSync(jobLog, 'utf-8').split('\n').filter(Boolean).slice(-200);
    return lines.map((l, i) => ({
      id: `swarm-${Date.now()}-${i}`,
      timestamp: new Date().toISOString(),
      level: l.toLowerCase().includes('error') ? 'error' as const
        : l.toLowerCase().includes('warn') ? 'warn' as const
        : l.toLowerCase().includes('fail') ? 'error' as const
        : 'info' as const,
      category: 'swarm' as const,
      message: l,
      source: 'swarm',
    }));
  } catch {
    return [];
  }
}

async function loadHistoryAuditEntries(tenantId: string, limit: number, db?: any): Promise<LogEntry[]> {
  try {
    if (!db) return [];
    const { getAllActiveServerNames, loadAllCallRecords } = await import('./db-aggregate.js');
    const srvs = await getAllActiveServerNames(db, tenantId);
    const records = await loadAllCallRecords(db, srvs, tenantId);
    const sorted = [...records].sort((a: any, b: any) =>
      ((b.timestamp as string) || '').localeCompare((a.timestamp as string) || ''),
    );
    return sorted.slice(0, limit).map((r: any) => ({
      id: `audit-${r.id || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: (r.timestamp as string) || new Date().toISOString(),
      level: r.blocked ? 'warn' as const : 'info' as const,
      category: 'policy_decision' as const,
      message: r.blocked
        ? `Blocked ${r.toolName} on ${r.serverName} — ${r.blockRule || 'no rule'}`
        : `Allowed ${r.toolName} on ${r.serverName}`,
      source: 'policy',
      details: (r.blockReason as string) || undefined,
      metadata: {
        server: r.serverName,
        tool: r.toolName,
        blocked: !!r.blocked,
        rule: r.blockRule,
        cost_usd: r.costUsd,
      },
    }));
  } catch {
    return [];
  }
}

async function loadAuditJsonlEntries(tenantId: string): Promise<LogEntry[]> {
  const entries: LogEntry[] = [];
  try {
    const { readTenantAuditJsonl } = await import('../audit/dashboard-access-log.js');
    const auditEntries = readTenantAuditJsonl(tenantId, 'policy-audit.jsonl', { limit: 200 });
    for (const e of (auditEntries as Array<Record<string, unknown>>) || []) {
      entries.push({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: (e.timestamp as string) || (e.createdAt as string) || new Date().toISOString(),
        level: 'info' as const,
        category: 'user_activity' as const,
        message: `Policy ${e.action || 'updated'} — ${e.ruleName || e.detail || ''}`,
        source: 'policy',
        details: (e.detail as string) || undefined,
        metadata: e as Record<string, unknown>,
      });
    }
    const accessEntries = readTenantAuditJsonl(tenantId, 'dashboard-access.jsonl', { limit: 200 });
    for (const e of (accessEntries as Array<Record<string, unknown>>) || []) {
      entries.push({
        id: `access-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: (e.timestamp as string) || new Date().toISOString(),
        level: (e.status as number) >= 400 ? 'warn' as const : 'info' as const,
        category: 'api_request' as const,
        message: `${e.method || 'GET'} ${e.path || ''} → ${e.status || 200}`,
        source: 'api',
        details: `User: ${e.userId || 'unknown'}, IP: ${e.ip || 'unknown'}`,
        metadata: e as Record<string, unknown>,
      });
    }
  } catch {
    // audit files may not exist
  }
  return entries;
}

async function loadAllRealEntries(tenantId: string, options: {
  search?: string;
  category?: string;
  level?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}, runtimeHistoryDb?: any): Promise<{ entries: LogEntry[]; total: number }> {
  const limit = options.limit || 100;

  const [jsonlResult, swarmEntries, auditEntries, accessEntries] = await Promise.all([
    Promise.resolve().then(() => loadLogEntries(tenantId, { ...options, limit: 500 })),
    loadSwarmLogs(tenantId),
    loadHistoryAuditEntries(tenantId, limit, runtimeHistoryDb),
    loadAuditJsonlEntries(tenantId),
  ]);

  let combined: LogEntry[] = [
    ...jsonlResult.entries,
    ...swarmEntries,
    ...auditEntries,
    ...accessEntries,
  ];

  if (options.search) {
    const q = options.search.toLowerCase();
    combined = combined.filter(e =>
      (e.message || '').toLowerCase().includes(q) ||
      (e.details || '').toLowerCase().includes(q)
    );
  }
  if (options.category) {
    combined = combined.filter(e => e.category === options.category);
  }
  if (options.level) {
    combined = combined.filter(e => e.level === options.level);
  }
  if (options.startDate) {
    const start = new Date(options.startDate).getTime();
    combined = combined.filter(e => new Date(e.timestamp).getTime() >= start);
  }
  if (options.endDate) {
    const end = new Date(options.endDate).getTime();
    combined = combined.filter(e => new Date(e.timestamp).getTime() <= end);
  }

  combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const total = combined.length;
  const offset = options.offset || 0;
  const entries = combined.slice(offset, offset + limit);

  return { entries, total };
}

export async function handleDashboardLogsRoutes(params: RouteParams): Promise<boolean> {
  const { url, method, req, res, requestTenantId, writeJson, readBody, setCors, runtimeHistoryDb } = params;

  // GET /api/logs/entries - query structured log entries from real sources
  if (url === '/api/logs/entries' && method === 'GET') {
    setCors();
    try {
      const u = new URL(req.url || url, 'http://localhost');
      const search = u.searchParams.get('search') || undefined;
      const category = u.searchParams.get('category') || undefined;
      const level = u.searchParams.get('level') || undefined;
      const startDate = u.searchParams.get('startDate') || undefined;
      const endDate = u.searchParams.get('endDate') || undefined;
      const limit = parseInt(u.searchParams.get('limit') || '100', 10);
      const offset = parseInt(u.searchParams.get('offset') || '0', 10);

      const { entries, total } = await loadAllRealEntries(requestTenantId, {
        search, category, level, startDate, endDate, limit, offset,
      }, runtimeHistoryDb);

      writeJson(res, 200, { entries, total, categories: CATEGORIES, levels: LEVELS });
    } catch (err: unknown) {
      writeJson(res, 500, {
        entries: [], total: 0,
        error: err instanceof Error ? err.message : 'Failed to query logs',
        categories: CATEGORIES, levels: LEVELS,
      });
    }
    return true;
  }

  // POST /api/logs/clear - clear logs
  if (url === '/api/logs/clear' && method === 'POST') {
    setCors();
    try {
      const body = await readBody(req);
      const category = body?.category as string | undefined;
      clearLogFiles(requestTenantId, category);
      writeJson(res, 200, { ok: true });
    } catch (err: unknown) {
      writeJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Failed to clear logs' });
    }
    return true;
  }

  // GET /api/logs/export - export logs as .log format
  if (url === '/api/logs/export' && method === 'GET') {
    setCors();
    try {
      const u = new URL(req.url || url, 'http://localhost');
      const { entries } = await loadAllRealEntries(requestTenantId, {
        search: u.searchParams.get('search') || undefined,
        category: u.searchParams.get('category') || undefined,
        level: u.searchParams.get('level') || undefined,
        limit: 10000,
      }, runtimeHistoryDb);

      const lines = entries.map(e =>
        `[${e.timestamp}] [${e.level.toUpperCase()}] [${e.category}]${e.source ? ` [${e.source}]` : ''} ${e.message}${e.details ? ` — ${e.details}` : ''}`,
      );

      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="mastyf-ai-logs-${new Date().toISOString().slice(0, 10)}.log"`,
      });
      res.end(lines.join('\n'));
    } catch (err: unknown) {
      writeJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Export failed' });
    }
    return true;
  }

  // GET /api/logs/retention - get retention config
  if (url === '/api/logs/retention' && method === 'GET') {
    setCors();
    const configPath = join(process.env.MASTYF_AI_DATA_DIR || join(process.cwd(), 'data'), 'tenants', requestTenantId, 'logs', 'retention.json');
    let config = { retentionDays: 30, maxSizeMb: 100, enabledCategories: CATEGORIES };
    if (existsSync(configPath)) {
      try {
        config = { ...config, ...JSON.parse(readFileSync(configPath, 'utf-8')) };
      } catch {
        // use defaults
      }
    }
    writeJson(res, 200, config);
    return true;
  }

  // PUT /api/logs/retention - update retention config
  if (url === '/api/logs/retention' && method === 'PUT') {
    setCors();
    try {
      const body = await readBody(req);
      const { writeFileSync, mkdirSync } = await import('fs');
      const logsDir = join(process.env.MASTYF_AI_DATA_DIR || join(process.cwd(), 'data'), 'tenants', requestTenantId, 'logs');
      if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
      const configPath = join(logsDir, 'retention.json');
      let config = { retentionDays: 30, maxSizeMb: 100, enabledCategories: CATEGORIES };
      if (existsSync(configPath)) {
        try {
          config = { ...config, ...JSON.parse(readFileSync(configPath, 'utf-8')) };
        } catch {
          // use defaults
        }
      }
      Object.assign(config, body);
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      writeJson(res, 200, { ok: true });
    } catch (err: unknown) {
      writeJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Failed to update retention config' });
    }
    return true;
  }

  return false;
}

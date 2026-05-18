import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join, extname } from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import { LRUCache } from 'lru-cache';
import { Logger } from './logger.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import {
  DashboardAuth,
  SESSION_COOKIE_NAME,
} from '../auth/dashboard-auth.js';
import { Registry } from 'prom-client';
import { WsBroadcaster } from '../dashboard/ws-broadcaster.js';
import { setWsBroadcaster } from './dashboard-events.js';
import {
  getAllActiveServerNames,
  loadAllCallRecords,
  securityRowFromScan,
  summarizeRecords,
} from './db-aggregate.js';
import { computeCostTrend, fetchCircuitBreakerStates } from './tui-sources.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function deployDir(): string | null {
  const candidates = [
    resolve(__dirname, '..', '..', 'deploy'),
    resolve(__dirname, '..', 'deploy'),
    resolve(process.cwd(), 'deploy'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Next static export (`out/`) when built; else legacy static files in `dashboard-spa/`. */
function dashboardSpaDir(deployRoot: string): string {
  const outDir = join(deployRoot, 'dashboard-spa', 'out');
  if (existsSync(join(outDir, 'index.html'))) return outDir;
  return join(deployRoot, 'dashboard-spa');
}

function loadDashboardHtml(): string {
  const dir = deployDir();
  const spaIndex = dir ? join(dashboardSpaDir(dir), 'index.html') : '';
  const useSpa = process.env['GUARDIAN_DASHBOARD_SPA'] !== 'false';
  if (useSpa && spaIndex && existsSync(spaIndex)) {
    return readFileSync(spaIndex, 'utf-8');
  }
  const legacy = dir ? join(dir, 'dashboard.html') : '';
  if (legacy && existsSync(legacy)) return readFileSync(legacy, 'utf-8');
  return '<!DOCTYPE html><html><body><h1>MCP Guardian API</h1><p>See README for REST and WebSocket endpoints.</p></body></html>';
}

const SPA_MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

function serveDashboardAsset(
  spaRoot: string,
  relPath: string,
  res: ServerResponse,
): boolean {
  if (!relPath || relPath.includes('..')) return false;
  const filePath = join(spaRoot, relPath);
  if (!existsSync(filePath)) return false;
  const mime = SPA_MIME[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(readFileSync(filePath));
  return true;
}

function tryServeDashboardSpa(url: string, res: ServerResponse): boolean {
  const dir = deployDir();
  if (!dir) return false;
  const spaRoot = dashboardSpaDir(dir);
  const legacyRoot = join(dir, 'dashboard-spa');

  if (url.startsWith('/_next/')) {
    return serveDashboardAsset(spaRoot, url.slice(1), res);
  }

  if (!url.startsWith('/dashboard-spa/')) return false;
  const rel = url.replace(/^\/dashboard-spa\//, '');
  if (serveDashboardAsset(spaRoot, rel, res)) return true;
  if (spaRoot !== legacyRoot) {
    return serveDashboardAsset(legacyRoot, rel, res);
  }
  return false;
}

function getCorsOrigin(req: IncomingMessage): string {
  const allowed = process.env['DASHBOARD_ALLOWED_ORIGINS']?.split(',').map(s => s.trim()).filter(Boolean)
    || ['http://localhost:4000', 'http://127.0.0.1:4000'];
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) return origin;
  if (allowed.length === 1) return allowed[0];
  return allowed[0];
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
}

// ── Real data source (set externally before dashboard starts) ─────
let runtimeHistoryDb: any = null;

type DashboardHandle = {
  auth: DashboardAuth;
  server: ReturnType<typeof createServer>;
  ws: WsBroadcaster | null;
};

let activeDashboard: DashboardHandle | null = null;

export function setDashboardDataSource(historyDb: any): void {
  runtimeHistoryDb = historyDb;
}

export async function startDashboardServer(
  port: number = 4000,
  policyWatcher?: PolicyWatcher,
  dashboardAuth?: DashboardAuth,
): Promise<{ auth: DashboardAuth; server: ReturnType<typeof createServer>; ws: WsBroadcaster | null }> {
  const dashboardEnabled = process.env['DASHBOARD_ENABLED'] === 'true';
  const wsEnabled = process.env['GUARDIAN_WS_ENABLED'] !== 'false';

  if (!dashboardEnabled && !wsEnabled) {
    Logger.debug('[dashboard] Dashboard/WS disabled (DASHBOARD_ENABLED or GUARDIAN_WS_ENABLED)');
    setWsBroadcaster(null);
    return {
      auth: dashboardAuth || new DashboardAuth({ enabled: false }),
      server: createServer((_req, res) => { res.writeHead(200); res.end(); }),
      ws: null,
    };
  }

  const auth = dashboardAuth || new DashboardAuth();
  const authRequired = dashboardEnabled && auth.requiresAuthentication();

  if (authRequired && auth.isConfigured()) {
    Logger.info('[dashboard] Dashboard authentication enabled');
  } else if (authRequired) {
    Logger.error(
      '[dashboard] Dashboard authentication required but DASHBOARD_API_KEY or DASHBOARD_JWT_SECRET is missing — all API requests will be rejected until configured',
    );
  } else {
    Logger.warn(
      '[dashboard] Dashboard API is UNauthenticated (DASHBOARD_AUTH_DISABLED=true) — do not expose to a network',
    );
  }

  const dashboardHtml = loadDashboardHtml();

  const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

  async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let data = '';
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }
        data += chunk.toString();
      });
      req.on('end', () => {
        try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
      });
      req.on('error', reject);
    });
  }

  async function readFormBody(req: IncomingMessage): Promise<Record<string, string>> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      req.on('end', () => {
        const result: Record<string, string> = {};
        if (data) {
          try {
            const params = new URLSearchParams(data);
            for (const [key, value] of params) { result[key] = value; }
          } catch { /* ignore */ }
        }
        resolve(result);
      });
    });
  }

  function writeJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  function getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      return (first || '').trim();
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  const loginRateLimiter: LRUCache<string, number> = new LRUCache({
    max: 500,
    ttl: 60000,
    updateAgeOnGet: false,
  });

  const apiRateLimiter: LRUCache<string, number> = new LRUCache({
    max: 10000,
    ttl: 60000,
    updateAgeOnGet: false,
  });

  const dashboardApiRateLimit = (): number => {
    const n = parseInt(process.env.GUARDIAN_DASHBOARD_API_RATE_LIMIT || '120', 10);
    return Number.isFinite(n) && n > 0 ? n : 120;
  };

  async function checkDashboardApiRateLimit(ip: string): Promise<boolean> {
    const limit = dashboardApiRateLimit();
    const key = `dashboard-api:${ip}`;
    try {
      const { isRedisConfigured } = await import('./redis-client.js');
      if (isRedisConfigured()) {
        const { getSharedRedisRateLimiter } = await import('./redis-rate-limiter.js');
        const rl = getSharedRedisRateLimiter();
        const { allowed } = await rl.checkAndIncrement(key, limit);
        return allowed;
      }
    } catch {
      /* fall back to in-process limiter */
    }
    const attempts = apiRateLimiter.get(ip) ?? 0;
    if (attempts >= limit) return false;
    apiRateLimiter.set(ip, attempts + 1);
    return true;
  }

  const server = createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0] || '/';
    const method = req.method || 'GET';

    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", "ws:", "wss:", "http://localhost:4000", "http://127.0.0.1:4000", "http://localhost:9090"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' as const },
    })(req, res, () => {});

    if (method === 'OPTIONS') {
      applyCors(req, res);
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Tenant-ID, X-CSRF-Token',
      });
      res.end(); return;
    }

    const setCors = () => applyCors(req, res);

    try {
      if (url === '/api/auth/csrf' && method === 'GET') {
        setCors();
        if (!auth.isCsrfEnforced()) {
          writeJson(res, 200, { csrfEnforced: false });
          return;
        }
        const csrfToken = auth.issueCsrfToken();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': auth.csrfSetCookieHeader(csrfToken),
        });
        res.end(JSON.stringify({ csrfToken, csrfEnforced: true }));
        return;
      }

      if (url === '/login' && method === 'GET') {
        setCors();
        if (auth.isEnabled() && auth.hasJwtSessionAuth()) {
          const csrfToken = auth.isCsrfEnforced() ? auth.issueCsrfToken() : undefined;
          const headers: Record<string, string> = { 'Content-Type': 'text/html' };
          if (csrfToken) headers['Set-Cookie'] = auth.csrfSetCookieHeader(csrfToken);
          res.writeHead(200, headers);
          res.end(auth.getLoginPageHtml(undefined, csrfToken));
        } else { res.writeHead(302, { 'Location': '/' }); res.end(); }
        return;
      }

      if (url === '/api/login' && method === 'POST') {
        setCors();
        const ip = getClientIp(req);
        const attempts = loginRateLimiter.get(ip) ?? 0;
        if (attempts >= 5) { writeJson(res, 429, { error: 'Too many login attempts' }); return; }
        loginRateLimiter.set(ip, attempts + 1);
        const contentType = req.headers['content-type'] || '';
        let body: Record<string, string>;
        if (contentType.includes('application/x-www-form-urlencoded')) body = await readFormBody(req);
        else body = await readBody(req) as unknown as Record<string, string>;

        if (auth.isCsrfEnforced()) {
          const csrfHeaders = auth.csrfHeadersFromForm(req.headers as Record<string, string | string[] | undefined>, body['_csrf']);
          const csrfCheck = auth.validateCsrfRequest(csrfHeaders);
          if (!csrfCheck.authenticated) {
            writeJson(res, 403, { success: false, error: csrfCheck.reason });
            return;
          }
        }

        const reqCookies = auth.parseCookies(
          typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
        );
        const existingSession = reqCookies[SESSION_COOKIE_NAME];

        const result = auth.login({
          url, headers: req.headers as Record<string, string | string[] | undefined>,
          body: { username: body.username, password: body.password, api_key: body.api_key },
          ip,
          existingSessionToken: existingSession,
        });

        if (result.success) {
          loginRateLimiter.delete(ip);
          const newCsrf = auth.issueCsrfToken();
          const setCookies = [
            auth.sessionSetCookieHeader(result.token!),
            auth.csrfSetCookieHeader(newCsrf),
          ];
          if (req.headers['content-type']?.includes('form')) {
            res.writeHead(302, { 'Location': '/', 'Set-Cookie': setCookies });
            res.end();
          } else {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Set-Cookie': setCookies,
            });
            res.end(JSON.stringify({ success: true, csrfToken: newCsrf }));
          }
        } else { writeJson(res, 401, { success: false, error: result.error }); }
        return;
      }

      if (tryServeDashboardSpa(url, res)) return;

      if (!dashboardEnabled) {
        setCors();
        if (url === '/' || url === '/dashboard.html') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(dashboardHtml);
          return;
        }
        writeJson(res, 404, { error: 'Dashboard API disabled; WebSocket at /ws only' });
        return;
      }

      const authResult = auth.authenticate({ url, headers: req.headers, method });
      if (!authResult.authenticated) {
        setCors();
        if (req.headers['accept']?.includes('text/html')) {
          res.writeHead(302, { 'Location': '/login' }); res.end();
        } else { writeJson(res, 401, { error: 'Authentication required', reason: authResult.reason }); }
        return;
      }

      if (tryServeDashboardSpa(url, res)) return;

      if (url === '/' || url === '/dashboard.html') { setCors(); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(dashboardHtml); return; }

      if (
        url.startsWith('/api/')
        && url !== '/api/login'
        && url !== '/api/auth/csrf'
      ) {
        const apiAllowed = await checkDashboardApiRateLimit(getClientIp(req));
        if (!apiAllowed) {
          setCors();
          writeJson(res, 429, { error: 'Too many API requests' });
          return;
        }
      }

      if (url === '/api/policy' && method === 'GET') {
        setCors();
        if (!policyWatcher?.get()) { writeJson(res, 404, { error: 'No active policy' }); return; }
        writeJson(res, 200, { mode: policyWatcher.get()!.getMode(), rules: 'Policy active' }); return;
      }

      if (url === '/api/policy/reload' && method === 'POST') {
        setCors();
        writeJson(res, 200, { status: 'ok', message: 'Policy watcher auto-detects changes' }); return;
      }

      if (url === '/api/admin/tenant' && method === 'GET') {
        setCors();
        writeJson(res, 200, {
          tenantId: process.env['GUARDIAN_TENANT_ID'] || 'default',
          policyPath: process.env['GUARDIAN_POLICY_PATH'] || process.env['MCP_GUARDIAN_POLICY_PATH'] || 'default-policy.yaml',
        });
        return;
      }

      if (url === '/api/admin/audit-trail' && method === 'GET') {
        setCors();
        const { getPolicyAuditor } = await import('./enterprise-bootstrap.js');
        const auditor = getPolicyAuditor();
        writeJson(res, 200, { entries: auditor?.readAuditTrail() || [] });
        return;
      }

      if (url === '/metrics') {
        setCors();
        if (auth.requiresAuthentication() && process.env['DASHBOARD_METRICS_PUBLIC'] !== 'true') {
          const metricsAuth = auth.authenticate({ url, headers: req.headers, method });
          if (!metricsAuth.authenticated) {
            writeJson(res, 401, { error: 'Authentication required for metrics' });
            return;
          }
        }
        try {
          const metricsPort = process.env['METRICS_PORT'] || '9090';
          const mr = await fetch(`http://localhost:${metricsPort}/metrics`);
          if (!mr.ok) throw new Error(`status ${mr.status}`);
          applyCors(req, res);
          res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
          res.end(await mr.text());
        } catch { writeJson(res, 200, { error: 'Metrics unavailable' }); }
        return;
      }

      if (url === '/api/auth/status' && method === 'GET') {
        setCors();
        writeJson(res, 200, {
          authenticated: true,
          identity: authResult.identity,
          authRequired,
          authConfigured: auth.isConfigured(),
        });
        return;
      }

      if (url === '/api/logout' && method === 'POST') {
        setCors();
        const ah = req.headers['authorization'];
        if (ah) {
          const m = ah.match(/^Bearer\s+(.+)$/i);
          if (m) auth.logout(m[1]);
        }
        const logoutCookies = auth.parseCookies(
          typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
        );
        if (logoutCookies[SESSION_COOKIE_NAME]) {
          auth.logout(logoutCookies[SESSION_COOKIE_NAME]);
        }
        writeJson(res, 200, { status: 'ok' }); return;
      }

      // ── AI APIs (set GUARDIAN_AI_ENABLED=false to disable) ──
      if (url.startsWith('/api/ai/')) {
        const { isAiLearningEnabled } = await import('./ai-enabled.js');
        if (!isAiLearningEnabled()) {
          setCors();
          writeJson(res, 503, { error: 'AI learning disabled. Set GUARDIAN_AI_ENABLED=false to disable.' });
          return;
        }
      }

      if (url === '/api/ai/suggestions' && method === 'GET') {
        setCors();
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const engine = getAiEngine();
          if (engine) {
            const report = await engine.generateReport();
            writeJson(res, 200, { suggestions: (report as any)?.suggestions || [], report });
            return;
          }
        } catch { /* fall through */ }
        writeJson(res, 200, { suggestions: [] }); return;
      }

      if (url === '/api/ai/report' && method === 'GET') {
        setCors();
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const engine = getAiEngine();
          if (engine) { const report = await engine.generateReport(); writeJson(res, 200, { report }); return; }
        } catch { /* fall through */ }
        writeJson(res, 200, { report: null }); return;
      }

      if (url === '/api/ai/state' && method === 'GET') {
        setCors();
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const engine = getAiEngine();
          if (engine) {
            const si = engine.getSelfImprovement();
            if (si) { const s = si.getState(); writeJson(res, 200, { state: { adaptiveThreshold: s.adaptiveThreshold, truePositiveRate: s.truePositiveRate, falsePositiveRate: s.falsePositiveRate, moduleWeights: s.moduleWeights } }); return; }
          }
        } catch { }
        writeJson(res, 200, { state: { adaptiveThreshold: 0.85, truePositiveRate: 0, falsePositiveRate: 0, moduleWeights: {} } }); return;
      }

      if (url === '/api/ai/baselines' && method === 'GET') {
        setCors();
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const engine = getAiEngine();
          if (engine) { writeJson(res, 200, { baselines: engine.getBaselineLearner().getAllBaselines() }); return; }
        } catch { }
        writeJson(res, 200, { baselines: [] }); return;
      }

      if (url === '/api/ai/threats' && method === 'GET') {
        setCors();
        try {
          const { readFileSync: rf, existsSync: ex } = await import('fs');
          const tp = resolve(__dirname, '..', '..', '.threat-state.json');
          if (ex(tp)) { const st = JSON.parse(rf(tp, 'utf-8')); writeJson(res, 200, { threats: st.ids?.length || 0, knownIds: st.ids || [] }); return; }
        } catch { }
        writeJson(res, 200, { threats: 0 }); return;
      }

      if (url === '/api/ai/rollback' && method === 'POST') {
        setCors();
        const { rollbackAiLearning } = await import('../ai/suggestion-engine.js');
        const result = rollbackAiLearning();
        if (!result.ok) {
          writeJson(res, 400, { error: result.reason || 'Rollback failed' });
          return;
        }
        writeJson(res, 200, { status: 'rolled_back', snapshotId: result.snapshotId });
        return;
      }

      // ── Data APIs (from HistoryDatabase) ──────────────────
      if (url === '/api/aggregate/metrics' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb;
          if (!db) { writeJson(res, 200, { totalInstances: 1, activeInstances: 1, totalRequests: 0 }); return; }
          const srvs = await getAllActiveServerNames(db);
          const records = await loadAllCallRecords(db, srvs);
          const sum = summarizeRecords(records);
          const avgLatency = sum.total > 0 ? Math.round(sum.totalLatency / sum.total) : 0;
          const passRate = sum.total > 0 ? Math.round((sum.passed / sum.total) * 100) : 100;
          writeJson(res, 200, {
            totalInstances: 1, activeInstances: 1, totalRequests: sum.total,
            blockedRequests: sum.blocked, passedRequests: sum.passed, totalCost: sum.costUsd,
            avgLatencyMs: avgLatency, activeServers: srvs.length, passRate,
            burnRatePerHour: sum.total > 0 ? (sum.costUsd / sum.total) * 100 : 0,
            lastUpdated: new Date().toISOString(),
          });
        } catch { writeJson(res, 200, { totalInstances: 1, totalRequests: 0 }); } return;
      }

      if (url === '/api/aggregate/audit' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb; if (!db) { writeJson(res, 200, { events: [], total: 0, blocked: 0, passed: 0 }); return; }
          const srvs = await getAllActiveServerNames(db);
          const records = await loadAllCallRecords(db, srvs);
          const sorted = [...records].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
          const evts = sorted.slice(0, 50).map((r) => ({
            timestamp: r.timestamp, server_name: r.serverName, tool_name: r.toolName,
            action: r.blocked ? 'block' : 'pass', rule: r.blockRule, reason: r.blockReason,
            request_tokens: r.requestTokens, response_tokens: r.responseTokens,
            total_tokens: r.totalTokens, duration_ms: r.durationMs,
          }));
          const blocked = records.filter((r) => r.blocked).length;
          writeJson(res, 200, { events: evts, total: records.length, blocked, passed: records.length - blocked, flagged: 0 });
        } catch { writeJson(res, 200, { events: [], total: 0, blocked: 0, passed: 0 }); } return;
      }

      if (url === '/api/security' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb; if (!db) { writeJson(res, 200, { serverReports: [], overallScore: 0, worstOffenders: [], activeThreats: 0 }); return; }
          const srvs = await getAllActiveServerNames(db); const reps: any[] = []; let ts = 0; let activeThreats = 0; let lastScan = 'N/A';
          for (const srv of srvs) {
            const sc = await db.getLatestSecurityScan(srv);
            if (sc) {
              const row = securityRowFromScan(sc as Record<string, unknown>, srv);
              reps.push(row); ts += row.score; activeThreats += row.critical + row.high;
              const at = (sc as { created_at?: string }).created_at;
              if (at && (lastScan === 'N/A' || at > lastScan)) lastScan = at;
            } else { reps.push({ name: srv, score: 0, cves: 0, critical: 0, high: 0, auth: false }); }
          }
          writeJson(res, 200, { serverReports: reps, overallScore: reps.length > 0 ? Math.round(ts / reps.length) : 0, worstOffenders: reps.filter((r: any) => r.score < 50).map((r: any) => r.name), activeThreats, lastScan });
        } catch { writeJson(res, 200, { serverReports: [], overallScore: 0, worstOffenders: [], activeThreats: 0 }); } return;
      }

      if (url === '/api/cost' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb; if (!db) { writeJson(res, 200, { serverReports: [], totalCost: 0, projectedMonthly: 0 }); return; }
          const srvs = await getAllActiveServerNames(db); const reps: any[] = []; let totalCost = 0;
          const { getRuntimeModelPricing } = await import('../services/runtime-model-pricing.js');
          const active = await getRuntimeModelPricing().getActivePricing();
          for (const srv of srvs) {
            const recs = await db.getCallRecordsForServer(srv);
            const sum = summarizeRecords(recs);
            reps.push({ name: srv, tokens: sum.totalInput + sum.totalOutput, cost: sum.costUsd, trend: computeCostTrend(recs), unpriced: sum.unpricedCalls });
            totalCost += sum.costUsd;
          }
          const pricingModel = active
            ? `${active.displayName} (${active.source})`
            : 'per-call stored rates';
          writeJson(res, 200, { serverReports: reps, totalCost, projectedMonthly: totalCost * 30, budgetAlerts: totalCost > 5 ? ['Monthly spend exceeding $150 budget threshold'] : [], pricingModel });
        } catch { writeJson(res, 200, { serverReports: [], totalCost: 0, projectedMonthly: 0 }); } return;
      }

      if (url === '/api/health' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb; if (!db) { writeJson(res, 200, { serverReports: [], atRisk: [], avgLatency: 0 }); return; }
          const srvs = await getAllActiveServerNames(db); const reps: any[] = []; let totalTools = 0; let latSum = 0; let latCount = 0;
          const cbStates = await fetchCircuitBreakerStates();
          for (const srv of srvs) {
            const recs = await db.getCallRecordsForServer(srv);
            const callLat = recs.length > 0 ? Math.round(recs.reduce((s: number, r: any) => s + (r.durationMs || 0), 0) / recs.length) : 0;
            const sr = await db.getRecentSuccessRate(srv);
            let latency = callLat;
            let tools = 0;
            if (typeof db.getLatestHealthCheck === 'function') {
              const hc = await db.getLatestHealthCheck(srv);
              if (hc) {
                latency = hc.latency_ms ?? hc.latencyMs ?? callLat;
                tools = hc.tool_count ?? hc.toolCount ?? 0;
              }
            }
            totalTools += tools;
            if (latency > 0) { latSum += latency; latCount++; }
            reps.push({ name: srv, latency, successRate: (sr ?? 1) * 100, tools, circuitBreaker: cbStates.get(srv) ?? 'closed' });
          }
          const avgLatency = latCount > 0 ? Math.round(latSum / latCount) : 0;
          const atRisk = reps.filter((h: any) => h.latency > 200 || h.successRate < 70).map((h: any) => h.name);
          writeJson(res, 200, { serverReports: reps, atRisk, avgLatency, totalTools });
        } catch { writeJson(res, 200, { serverReports: [], atRisk: [], avgLatency: 0 }); } return;
      }

      if (url === '/api/instances' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb;
          let sum = { total: 0, blocked: 0, costUsd: 0, totalLatency: 0 };
          if (db) {
            const srvs = await getAllActiveServerNames(db);
            const records = await loadAllCallRecords(db, srvs);
            sum = summarizeRecords(records);
          }
          const avgLatency = sum.total > 0 ? Math.round(sum.totalLatency / sum.total) : 0;
          writeJson(res, 200, [{ instanceId: process.env['GUARDIAN_INSTANCE_ID'] || `guardian-${process.pid}`, instanceName: process.env['HOSTNAME'] || 'localhost', status: 'active', hostname: process.env['HOSTNAME'] || 'unknown', version: process.env.npm_package_version || '2.3.24', lastHeartbeat: new Date().toISOString(), totalRequests: sum.total, blockedRequests: sum.blocked, totalCostUsd: sum.costUsd, avgLatencyMs: avgLatency }]);
        } catch { writeJson(res, 200, []); } return;
      }

      if (url === '/api/policy/suggestions/accept' && method === 'POST') {
        setCors();
        const b = await readBody(req);
        const { recordSuggestionOutcome } = await import('../ai/suggestion-engine.js');
        const policyPath = process.env['GUARDIAN_POLICY_PATH'] || process.env['MCP_GUARDIAN_POLICY_PATH'] || 'default-policy.yaml';
        await recordSuggestionOutcome(String(b.suggestionId || ''), 'applied', {
          ruleName: String(b.ruleName || b.suggestionId || 'unknown'),
          source: (b.source as 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern' | 'attack') || 'baseline',
          confidence: typeof b.confidence === 'number' ? b.confidence : 0.5,
          rule: b.rule as import('../policy/policy-types.js').PolicyRule | undefined,
          policyPath,
          policyWatcher: policyWatcher ?? null,
          userId: authResult.identity || String(b.userId || ''),
        });
        writeJson(res, 200, { status: 'accepted', id: b.suggestionId });
        return;
      }
      if (url === '/api/policy/suggestions/reject' && method === 'POST') {
        setCors();
        const b2 = await readBody(req);
        const { recordSuggestionOutcome } = await import('../ai/suggestion-engine.js');
        await recordSuggestionOutcome(String(b2.suggestionId || ''), 'rejected', {
          ruleName: String(b2.ruleName || b2.suggestionId || 'unknown'),
          source: (b2.source as 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern') || 'baseline',
          confidence: typeof b2.confidence === 'number' ? b2.confidence : 0.5,
          userId: authResult.identity || String(b2.userId || ''),
          pattern: b2.pattern ? String(b2.pattern) : undefined,
        });
        if (b2.fpReject && b2.rule && b2.pattern) {
          const { recordFpRejection } = await import('../ai/fp-whitelist.js');
          const fp = recordFpRejection(String(b2.rule), String(b2.pattern), {
            userId: authResult.identity || String(b2.userId || ''),
          });
          writeJson(res, 200, { status: 'rejected', id: b2.suggestionId, fp });
          return;
        }
        writeJson(res, 200, { status: 'rejected', id: b2.suggestionId });
        return;
      }
      if (url === '/api/policy/fp/reject' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const { recordFpRejection } = await import('../ai/fp-whitelist.js');
        const fp = recordFpRejection(String(body.rule || ''), String(body.pattern || body.patternId || ''), {
          userId: authResult.identity || String(body.userId || ''),
        });
        writeJson(res, 200, { status: 'recorded', ...fp });
        return;
      }
      if (url === '/api/logs' && method === 'GET') { setCors(); writeJson(res, 200, { logs: [], total: 0 }); return; }

      setCors(); writeJson(res, 404, { error: 'Not found' });
    } catch (err: any) { setCors(); writeJson(res, 500, { error: err?.message || 'Internal error' }); }
  });

  let ws: WsBroadcaster | null = null;

  const listenPort = await new Promise<number | null>((resolve) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        Logger.warn(
          `[dashboard] Port ${port} already in use — proxy will run without local dashboard/WS. ` +
            `Stop the other process or set DASHBOARD_PORT / GUARDIAN_WS_ENABLED=false.`,
        );
        resolve(null);
        return;
      }
      Logger.warn(`[dashboard] Failed to bind port ${port}: ${err.message}`);
      resolve(null);
    };

    server.once('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      resolve(port);
    });
  });

  if (listenPort === null) {
    setWsBroadcaster(null);
    try {
      server.close();
    } catch {
      /* ignore */
    }
    return { auth, server, ws: null };
  }

  ws = new WsBroadcaster(server);
  setWsBroadcaster(ws);
  if (dashboardEnabled) {
    ws.startDataPushLoop(parseInt(process.env['GUARDIAN_WS_PUSH_INTERVAL_MS'] || '5000', 10));
  }
  const mode = dashboardEnabled ? 'dashboard + WS' : 'WS only';
  Logger.info(`[dashboard] ${mode} at http://localhost:${listenPort}/ws`);

  const handle = { auth, server, ws };
  activeDashboard = handle;
  return handle;
}

/** Stop WS push loop and close the dashboard HTTP server (proxy/TUI shutdown). */
export async function closeDashboardServer(): Promise<void> {
  const handle = activeDashboard;
  if (!handle) return;
  activeDashboard = null;
  handle.ws?.stopDataPushLoop();
  handle.auth.dispose();
  setWsBroadcaster(null);
  await new Promise<void>((resolve) => {
    handle.server.close(() => resolve());
  });
  handle.server.removeAllListeners();
}
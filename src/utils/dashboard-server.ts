import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import { LRUCache } from 'lru-cache';
import { Logger } from './logger.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import { DashboardAuth } from '../auth/dashboard-auth.js';
import { Registry } from 'prom-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Real data source (set externally before dashboard starts) ─────
let runtimeHistoryDb: any = null;

export function setDashboardDataSource(historyDb: any): void {
  runtimeHistoryDb = historyDb;
}

export async function startDashboardServer(
  port: number = 4000,
  policyWatcher?: PolicyWatcher,
  dashboardAuth?: DashboardAuth,
): Promise<{ auth: DashboardAuth; server: ReturnType<typeof createServer> }> {
  if (process.env['DASHBOARD_ENABLED'] !== 'true') {
    Logger.debug('[dashboard] Dashboard server not enabled (set DASHBOARD_ENABLED=true)');
    return { auth: dashboardAuth || new DashboardAuth({ enabled: false }), server: createServer((_req, res) => {
      res.writeHead(200);
      res.end();
    }) };
  }

  const auth = dashboardAuth || new DashboardAuth();
  const authEnabled = auth.isEnabled();

  if (authEnabled) {
    Logger.info('[dashboard] Dashboard authentication enabled');
  } else {
    Logger.info('[dashboard] Dashboard running without authentication (set DASHBOARD_AUTH_ENABLED=true)');
  }

  const dashboardHtml = readFileSync(resolve(__dirname, '..', '..', 'deploy', 'dashboard.html'), 'utf-8');

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

  const loginRateLimiter: LRUCache<string, number> = new LRUCache({ max: 500, ttl: 60000 });

  const server = createServer(async (req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"], connectSrc: ["'self'", "http://localhost:9090"], frameAncestors: ["'none'"],
        },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' as const },
    })(req, res, () => {});

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      });
      res.end(); return;
    }

    const setCors = () => { res.setHeader('Access-Control-Allow-Origin', '*'); };

    try {
      if (url === '/login' && method === 'GET') {
        setCors();
        if (auth.isEnabled() && auth.hasJwtSessionAuth()) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(auth.getLoginPageHtml());
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

        const result = auth.login({
          url, headers: req.headers as any,
          body: { username: body.username, password: body.password, api_key: body.api_key }, ip,
        });

        if (result.success) {
          loginRateLimiter.delete(ip);
          if (req.headers['content-type']?.includes('form')) {
            // Set session cookie only; do not expose token in URL
            res.writeHead(302, { 'Location': '/', 'Set-Cookie': `mcp_guardian_session=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600` });
            res.end();
          } else { writeJson(res, 200, { success: true }); }
        } else { writeJson(res, 401, { success: false, error: result.error }); }
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

      if (url === '/' || url === '/dashboard.html') { setCors(); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(dashboardHtml); return; }

      if (url === '/api/policy' && method === 'GET') {
        setCors();
        if (!policyWatcher?.get()) { writeJson(res, 404, { error: 'No active policy' }); return; }
        writeJson(res, 200, { mode: policyWatcher.get()!.getMode(), rules: 'Policy active' }); return;
      }

      if (url === '/api/policy/reload' && method === 'POST') {
        setCors();
        writeJson(res, 200, { status: 'ok', message: 'Policy watcher auto-detects changes' }); return;
      }

      if (url === '/metrics') {
        setCors();
        try {
          const metricsPort = process.env['METRICS_PORT'] || '9090';
          const mr = await fetch(`http://localhost:${metricsPort}/metrics`);
          if (!mr.ok) throw new Error(`status ${mr.status}`);
          res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(await mr.text());
        } catch { writeJson(res, 200, { error: 'Metrics unavailable' }); }
        return;
      }

      if (url === '/api/auth/status' && method === 'GET') { setCors(); writeJson(res, 200, { authenticated: true, identity: authResult.identity, authEnabled }); return; }

      if (url === '/api/logout' && method === 'POST') {
        setCors();
        const ah = req.headers['authorization']; if (ah) { const m = ah.match(/^Bearer\s+(.+)$/i); if (m) auth.logout(m[1]); }
        writeJson(res, 200, { status: 'ok' }); return;
      }

      // ── AI APIs (wired to running SuggestionEngine) ────────
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

      // ── Data APIs (from HistoryDatabase) ──────────────────
      if (url === '/api/aggregate/metrics' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb;
          if (!db) { writeJson(res, 200, { totalInstances: 1, activeInstances: 1, totalRequests: 0 }); return; }
          const srvs = await db.getDistinctScannedServers();
          let tr = 0; for (const s of srvs) { tr += (await db.getCallRecordsForServer(s)).length; }
          writeJson(res, 200, { totalInstances: 1, activeInstances: 1, totalRequests: tr, blockedRequests: 0, passedRequests: tr, totalCost: 0, avgLatencyMs: 0, activeServers: srvs.length, burnRatePerHour: 0, lastUpdated: new Date().toISOString() });
        } catch { writeJson(res, 200, { totalInstances: 1, totalRequests: 0 }); } return;
      }

      if (url === '/api/aggregate/audit' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb; if (!db) { writeJson(res, 200, { events: [], total: 0, blocked: 0, passed: 0 }); return; }
          const srvs = await db.getDistinctScannedServers(); const evts: any[] = [];
          for (const srv of srvs.slice(0, 5)) { const recs = await db.getCallRecordsForServer(srv); for (const r of recs.slice(0, 10)) evts.push({ timestamp: r.timestamp, server_name: r.serverName, tool_name: r.toolName, action: 'pass', request_tokens: r.requestTokens, response_tokens: r.responseTokens, total_tokens: r.totalTokens, duration_ms: r.durationMs }); }
          writeJson(res, 200, { events: evts, total: evts.length, blocked: 0, passed: evts.length, flagged: 0 });
        } catch { writeJson(res, 200, { events: [], total: 0, blocked: 0, passed: 0 }); } return;
      }

      if (url === '/api/security' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb; if (!db) { writeJson(res, 200, { serverReports: [], overallScore: 0, worstOffenders: [], activeThreats: 0 }); return; }
          const srvs = await db.getDistinctScannedServers(); const reps: any[] = []; let ts = 0;
          for (const srv of srvs) {
            const sc = await db.getLatestSecurityScan(srv);
            if (sc) { reps.push({ name: sc.server_name || srv, score: sc.score || 50, cves: sc.cve_count || 0, critical: (sc.details?.cves || []).filter((c: any) => c.severity === 'CRITICAL').length, auth: !!(sc.details?.authStatus?.hasAuthentication) }); ts += sc.score || 50; }
            else { reps.push({ name: srv, score: 0, cves: 0, critical: 0, auth: false }); }
          }
          writeJson(res, 200, { serverReports: reps, overallScore: reps.length > 0 ? Math.round(ts / reps.length) : 0, worstOffenders: reps.filter((r: any) => r.score < 50).map((r: any) => r.name), activeThreats: 0, lastScan: new Date().toISOString() });
        } catch { writeJson(res, 200, { serverReports: [], overallScore: 0, worstOffenders: [], activeThreats: 0 }); } return;
      }

      if (url === '/api/cost' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb; if (!db) { writeJson(res, 200, { serverReports: [], totalCost: 0, projectedMonthly: 0 }); return; }
          const srvs = await db.getDistinctScannedServers(); const reps: any[] = [];
          for (const srv of srvs) { const recs = await db.getCallRecordsForServer(srv); const tok = recs.reduce((s: number, r: any) => s + r.totalTokens, 0); reps.push({ name: srv, tokens: tok, cost: 0, trend: 'flat' }); }
          writeJson(res, 200, { serverReports: reps, totalCost: 0, projectedMonthly: 0, budgetAlerts: [], pricingModel: 'live' });
        } catch { writeJson(res, 200, { serverReports: [], totalCost: 0, projectedMonthly: 0 }); } return;
      }

      if (url === '/api/health' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb; if (!db) { writeJson(res, 200, { serverReports: [], atRisk: [], avgLatency: 0 }); return; }
          const srvs = await db.getDistinctScannedServers(); const reps: any[] = [];
          for (const srv of srvs) { const sr = await db.getRecentSuccessRate(srv); reps.push({ name: srv, latency: 0, successRate: (sr || 0) * 100, tools: 0, circuitBreaker: 'closed' }); }
          writeJson(res, 200, { serverReports: reps, atRisk: [], avgLatency: 0, totalTools: 0 });
        } catch { writeJson(res, 200, { serverReports: [], atRisk: [], avgLatency: 0 }); } return;
      }

      if (url === '/api/instances' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb; let tr = 0;
          if (db) { const srvs = await db.getDistinctScannedServers(); for (const srv of srvs) { tr += (await db.getCallRecordsForServer(srv)).length; } }
          writeJson(res, 200, [{ instanceId: process.env['GUARDIAN_INSTANCE_ID'] || `guardian-${process.pid}`, instanceName: process.env['HOSTNAME'] || 'localhost', status: 'active', hostname: process.env['HOSTNAME'] || 'unknown', version: process.env.npm_package_version || '2.3.24', lastHeartbeat: new Date().toISOString(), totalRequests: tr, blockedRequests: 0, totalCostUsd: 0, avgLatencyMs: 0 }]);
        } catch { writeJson(res, 200, []); } return;
      }

      if (url === '/api/policy/suggestions/accept' && method === 'POST') { setCors(); const b = await readBody(req); writeJson(res, 200, { status: 'accepted', id: b.suggestionId }); return; }
      if (url === '/api/policy/suggestions/reject' && method === 'POST') { setCors(); const b2 = await readBody(req); writeJson(res, 200, { status: 'rejected', id: b2.suggestionId }); return; }
      if (url === '/api/logs' && method === 'GET') { setCors(); writeJson(res, 200, { logs: [], total: 0 }); return; }

      setCors(); writeJson(res, 404, { error: 'Not found' });
    } catch (err: any) { setCors(); writeJson(res, 500, { error: err?.message || 'Internal error' }); }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      Logger.info(`[dashboard] Dashboard available at http://localhost:${port}${authEnabled ? ' (auth enabled)' : ''}`);
      resolve();
    });
  });

  return { auth, server };
}
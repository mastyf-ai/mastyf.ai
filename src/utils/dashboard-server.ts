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
import {
  assertTenantAdminScope,
  canAccessRoute,
} from '../auth/dashboard-rbac.js';
import { resolveTenantContext, InvalidTenantIdError, isMultiTenantModeEnabled } from '../tenant/resolve-tenant.js';
import { tenantRateLimitKey } from './redis-rate-limiter.js';
import { Registry } from 'prom-client';
import { WsBroadcaster } from '../dashboard/ws-broadcaster.js';
import { setWsBroadcaster } from './dashboard-events.js';
import { wireDashboardWsProviders } from './dashboard-ws-wire.js';
import {
  getLicenseClient,
  isLicenseEnforcementEnabled,
  loadLicenseClientConfig,
} from '../license/license-client.js';
import { mapCloudRoles, verifyCloudSessionToken } from '../license/cloud-session.js';
import {
  getAllActiveServerNames,
  loadAllCallRecords,
  securityRowFromScan,
  summarizeRecords,
} from './db-aggregate.js';
import { computeCostTrend, fetchCircuitBreakerStates } from './tui-sources.js';
import { REPO_ROOT } from './security-swarm-runner.js';
import { available, unavailable, defaultPolicyPath, parseCostBudgetUsd } from './dashboard-live-data.js';

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
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};

function serveDashboardAsset(
  spaRoot: string,
  relPath: string,
  res: ServerResponse,
  method: string = 'GET',
): boolean {
  if (!relPath || relPath.includes('..')) return false;
  const filePath = join(spaRoot, relPath);
  if (!existsSync(filePath)) return false;
  const mime = SPA_MIME[extname(filePath)] || 'application/octet-stream';
  const headers: Record<string, string> = { 'Content-Type': mime };
  if (relPath.includes('_next/static/')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }
  res.writeHead(200, headers);
  if (method === 'HEAD') {
    res.end();
  } else {
    res.end(readFileSync(filePath));
  }
  return true;
}

function writeSpaNotFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Static asset not found' }));
}

function tryServeDashboardSpa(
  url: string,
  res: ServerResponse,
  opts?: { notFoundOnMiss?: boolean },
): boolean {
  const dir = deployDir();
  if (!dir) return false;
  const spaRoot = dashboardSpaDir(dir);
  const legacyRoot = join(dir, 'dashboard-spa');

  const method = res.req?.method || 'GET';

  if (url.startsWith('/_next/')) {
    const ok = serveDashboardAsset(spaRoot, url.slice(1), res, method);
    if (!ok && opts?.notFoundOnMiss) writeSpaNotFound(res);
    return ok || !!opts?.notFoundOnMiss;
  }

  if (url === '/favicon.ico') {
    if (serveDashboardAsset(spaRoot, 'favicon.ico', res, method)) return true;
    if (method === 'GET' || method === 'HEAD') {
      res.writeHead(204, { 'Content-Type': 'image/x-icon' });
      res.end();
      return true;
    }
  }

  if (!url.startsWith('/dashboard-spa/')) return false;
  const rel = url.replace(/^\/dashboard-spa\//, '');
  if (serveDashboardAsset(spaRoot, rel, res, method)) return true;
  if (spaRoot !== legacyRoot) {
    return serveDashboardAsset(legacyRoot, rel, res, method);
  }
  return false;
}

function tryServeSwarmArtifact(url: string, res: ServerResponse, method: string = 'GET'): boolean {
  let root: string | null = null;
  let rel: string | null = null;

  const legacyPrefix = '/reports/security-swarm/';
  const tenantPrefixMatch = url.match(/^\/reports\/tenants\/([a-zA-Z0-9][a-zA-Z0-9-]*)\/security-swarm\/(.+)$/);
  if (tenantPrefixMatch) {
    root = join(REPO_ROOT, 'reports', 'tenants', tenantPrefixMatch[1], 'security-swarm');
    rel = tenantPrefixMatch[2];
  } else if (url.startsWith(legacyPrefix)) {
    root = join(REPO_ROOT, 'reports', 'security-swarm');
    rel = url.slice(legacyPrefix.length);
  }
  if (!root || !rel || rel.includes('..')) return false;

  const filePath = join(root, rel);
  if (!existsSync(filePath)) return false;

  const mime = SPA_MIME[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  if (method === 'HEAD') {
    res.end();
  } else {
    res.end(readFileSync(filePath));
  }
  return true;
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
  const handle = activeDashboard;
  if (handle?.ws) {
    wireDashboardWsProviders(handle.ws, historyDb);
  }
}

export async function startDashboardServer(
  port: number = 4000,
  policyWatcher?: PolicyWatcher,
  dashboardAuth?: DashboardAuth,
): Promise<{ auth: DashboardAuth; server: ReturnType<typeof createServer>; ws: WsBroadcaster | null }> {
  const licenseClient = getLicenseClient();
  if (
    process.env['DASHBOARD_AUTH_DISABLED'] === 'true'
    && (licenseClient.requiresLicense() || isLicenseEnforcementEnabled())
  ) {
    Logger.error(
      '[license] DASHBOARD_AUTH_DISABLED is not allowed when cloud license enforcement is enabled',
    );
  }

  const licenseOk = await licenseClient.start();
  const licenseRequired = isLicenseEnforcementEnabled() && licenseClient.requiresLicense();

  let dashboardEnabled = process.env['DASHBOARD_ENABLED'] === 'true';
  const wsEnabled = process.env['GUARDIAN_WS_ENABLED'] !== 'false';

  if (licenseRequired && !licenseOk) {
    Logger.error('[license] Dashboard and WebSocket disabled — license enforcement failed');
    dashboardEnabled = false;
  }

  if (!dashboardEnabled && !wsEnabled) {
    Logger.debug('[dashboard] Dashboard/WS disabled (DASHBOARD_ENABLED or GUARDIAN_WS_ENABLED)');
    setWsBroadcaster(null);
    return {
      auth: dashboardAuth || new DashboardAuth({ enabled: false }),
      server: createServer((_req, res) => { res.writeHead(200); res.end(); }),
      ws: null,
    };
  }

  function licenseStatusPayload() {
    const enforced = isLicenseEnforcementEnabled();
    if (!enforced) {
      return {
        licensed: true,
        licenseEnforced: false,
        licenseRequired: false,
        tenantSlug: licenseClient.getTenantSlug() ?? null,
        licenseStatus: 'not_enforced',
        cloudBillingUrl: null,
        features: [] as string[],
      };
    }
    const state = licenseClient.getState();
    const licensed = licenseClient.isLicensed();
    return {
      licensed,
      licenseEnforced: true,
      licenseRequired,
      tenantSlug: licenseClient.getTenantSlug() ?? null,
      licenseStatus: state?.status ?? 'unknown',
      cloudBillingUrl: licenseClient.getCloudBillingUrl() ?? null,
      features: state?.features ?? [],
    };
  }

  function isLicenseExemptPath(path: string): boolean {
    return (
      path === '/api/license/status'
      || path === '/api/auth/cloud-exchange'
      || path === '/api/auth/csrf'
      || path === '/login'
    );
  }

  function assertLicensedApi(path: string, res: ServerResponse, setCors: () => void): boolean {
    if (!isLicenseEnforcementEnabled() || isLicenseExemptPath(path)) return true;
    if (licenseClient.isLicensed()) return true;
    setCors();
    writeJson(res, 402, {
      error: 'License required',
      ...licenseStatusPayload(),
    });
    return false;
  }

  function assertFeature(_path: string, feature: string, res: ServerResponse, setCors: () => void): boolean {
    if (!isLicenseEnforcementEnabled() || licenseClient.hasFeature(feature)) return true;
    setCors();
    writeJson(res, 402, { error: `Feature not licensed: ${feature}` });
    return false;
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
    if (process.env.DASHBOARD_AUTH_DISABLED === 'true') {
      return 5000;
    }
    const n = parseInt(process.env.GUARDIAN_DASHBOARD_API_RATE_LIMIT || '600', 10);
    return Number.isFinite(n) && n > 0 ? n : 600;
  };

  /** Read-only endpoints used for health/polling — not counted toward API rate limit. */
  function isDashboardRateLimitExempt(path: string, method: string): boolean {
    if (method !== 'GET') return false;
    return (
      path === '/api/auth/status'
      || path === '/api/license/status'
      || path === '/api/auth/csrf'
      ||       path === '/api/security-swarm/status'
      || path === '/api/security-swarm/live-session'
      || path === '/api/security-swarm/report-json'
      || path === '/api/security-swarm/traffic-summary'
      || path === '/api/security-swarm/user-servers'
      || path === '/api/onboarding/status'
      || path === '/api/servers/registry'
      || path === '/api/visuals/live'
    );
  }

  async function checkDashboardApiRateLimit(ip: string, tenantId: string): Promise<boolean> {
    const limit = dashboardApiRateLimit();
    const key = `dashboard-api:${ip}`;
    try {
      const { isRedisConfigured } = await import('./redis-client.js');
      if (isRedisConfigured()) {
        const { getSharedRedisRateLimiter } = await import('./redis-rate-limiter.js');
        const rl = getSharedRedisRateLimiter();
        const { allowed } = await rl.checkAndIncrement(key, limit, 60000, tenantId);
        return allowed;
      }
    } catch {
      /* fall back to in-process limiter */
    }
    const scopedKey = tenantRateLimitKey(tenantId, ip);
    const attempts = apiRateLimiter.get(scopedKey) ?? 0;
    if (attempts >= limit) return false;
    apiRateLimiter.set(scopedKey, attempts + 1);
    return true;
  }

  const server = createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0] || '/';
    const method = req.method || 'GET';

    // Next.js static export: serve before helmet/auth (correct MIME; nosniff-safe)
    if (method === 'GET' || method === 'HEAD') {
      if (tryServeDashboardSpa(url, res, { notFoundOnMiss: url.startsWith('/_next/') })) {
        return;
      }
      if (tryServeSwarmArtifact(url, res, method)) {
        return;
      }
    }

    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Next.js static export (RSC payload) uses inline <script> blocks — hashes change each build
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcElem: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: [
            "'self'",
            'ws:',
            'wss:',
            'http://localhost:4000',
            'http://127.0.0.1:4000',
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:9090',
          ],
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Tenant-Id, X-Guardian-Tenant, X-CSRF-Token',
      });
      res.end(); return;
    }

    const setCors = () => applyCors(req, res);

    let requestTenantId = process.env['GUARDIAN_TENANT_ID'] || 'default';
    try {
      requestTenantId = resolveTenantContext({
        headers: req.headers as Record<string, string | string[] | undefined>,
      }).tenantId;
    } catch (err) {
      if (err instanceof InvalidTenantIdError) {
        setCors();
        writeJson(res, 400, { error: err.message });
        return;
      }
      throw err;
    }

    try {
      if (url === '/api/license/status' && method === 'GET') {
        setCors();
        writeJson(res, 200, licenseStatusPayload());
        return;
      }

      if (url === '/api/auth/status' && method === 'GET' && dashboardEnabled) {
        setCors();
        const probe = auth.authenticate({
          url: req.url,
          headers: req.headers as Record<string, string | string[] | undefined>,
          method,
        });
        if (!probe.authenticated) {
          writeJson(res, 200, {
            authenticated: false,
            authRequired,
            authConfigured: auth.isConfigured(),
            ...licenseStatusPayload(),
          });
          return;
        }
      }

      if (url === '/api/auth/cloud-exchange' && method === 'GET') {
        setCors();
        const fullUrl = new URL(req.url || '/', 'http://localhost');
        const exchangeToken = fullUrl.searchParams.get('token')?.trim();
        if (!exchangeToken) {
          writeJson(res, 400, { error: 'token query parameter required' });
          return;
        }

        if (!auth.hasJwtSessionAuth()) {
          writeJson(res, 503, { error: 'DASHBOARD_JWT_SECRET required for cloud exchange' });
          return;
        }

        let sessionToken: string | undefined;
        let tenantSlug: string | undefined;

        const controlPlaneUrl = loadLicenseClientConfig().controlPlaneUrl;
        if (!controlPlaneUrl) {
          writeJson(res, 503, { error: 'GUARDIAN_CONTROL_PLANE_URL not configured' });
          return;
        }
        const exchanged = await licenseClient.exchangeCloudToken(exchangeToken);
        if (!exchanged?.sessionToken) {
          writeJson(res, 401, { error: 'Invalid or expired exchange token' });
          return;
        }
        sessionToken = exchanged.sessionToken;
        tenantSlug = exchanged.tenantSlug;

        const cloudPayload = verifyCloudSessionToken(sessionToken);
        if (!cloudPayload) {
          writeJson(res, 401, { error: 'Invalid cloud session token' });
          return;
        }

        const token = auth.createCloudSession(
          tenantSlug ?? cloudPayload.tenantSlug,
          cloudPayload.identity,
          mapCloudRoles(cloudPayload.roles),
        );
        const csrfToken = auth.isCsrfEnforced() ? auth.issueCsrfToken() : undefined;
        const cookies = [auth.sessionSetCookieHeader(token)];
        if (csrfToken) cookies.push(auth.csrfSetCookieHeader(csrfToken));
        res.writeHead(302, { Location: '/', 'Set-Cookie': cookies });
        res.end();
        return;
      }

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
        const scopedLoginKey = tenantRateLimitKey(requestTenantId, ip);
        const attempts = loginRateLimiter.get(scopedLoginKey) ?? 0;
        if (attempts >= 5) { writeJson(res, 429, { error: 'Too many login attempts' }); return; }
        loginRateLimiter.set(scopedLoginKey, attempts + 1);
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
          loginRateLimiter.delete(scopedLoginKey);
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

      if (!dashboardEnabled) {
        setCors();
        if (url === '/' || url === '/dashboard.html') {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          });
          res.end(loadDashboardHtml());
          return;
        }
        writeJson(res, 404, { error: 'Dashboard API disabled; WebSocket at /ws only' });
        return;
      }

      if (url.startsWith('/api/') && !assertLicensedApi(url, res, setCors)) {
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

      if (url === '/' || url === '/dashboard.html') {
        setCors();
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        });
        res.end(loadDashboardHtml());
        return;
      }

      const roles = auth.getRolesForAuth(authResult);
      const tenantScope = assertTenantAdminScope(
        roles,
        authResult.sessionTenantId,
        requestTenantId,
      );
      if (!tenantScope.ok) {
        setCors();
        writeJson(res, 403, { error: 'Forbidden', reason: tenantScope.reason });
        return;
      }

      const rbac = canAccessRoute(roles, method, req.url || url);
      if (!rbac.allowed) {
        setCors();
        writeJson(res, 403, { error: 'Forbidden', reason: rbac.reason, required: rbac.required });
        return;
      }

      if (
        url.startsWith('/api/')
        && url !== '/api/login'
        && !isDashboardRateLimitExempt(url, method)
      ) {
        const apiAllowed = await checkDashboardApiRateLimit(getClientIp(req), requestTenantId);
        if (!apiAllowed) {
          setCors();
          writeJson(res, 429, { error: 'Too many API requests' });
          return;
        }
      }

      if (url === '/api/policy' && method === 'GET') {
        setCors();
        const policyPath = defaultPolicyPath();
        let yaml = '';
        if (existsSync(policyPath)) {
          try {
            yaml = readFileSync(policyPath, 'utf-8');
          } catch {
            yaml = '';
          }
        }
        const mode = policyWatcher?.get()?.getMode() || 'audit';
        writeJson(res, 200, {
          mode,
          rules: yaml ? `${yaml.split('\n').length} lines` : 'No policy file',
          yaml,
          path: policyPath,
        });
        return;
      }

      if (url === '/api/policy/reload' && method === 'POST') {
        setCors();
        writeJson(res, 200, { status: 'ok', message: 'Policy watcher auto-detects changes' }); return;
      }

      if (url === '/api/policy/test' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const { runPolicyTest } = await import('../cli/policy-test.js');
        const policyPath =
          process.env['GUARDIAN_POLICY_PATH'] ||
          process.env['MCP_GUARDIAN_POLICY_PATH'] ||
          'default-policy.yaml';
        const result = runPolicyTest({
          policy: String(body.policyPath || policyPath),
          tool: String(body.tool || 'unknown'),
          args: JSON.stringify(body.arguments ?? {}),
          server: String(body.server || 'dashboard-test'),
          blockingMode: body.mode ? String(body.mode) : undefined,
        });
        writeJson(res, 200, result);
        return;
      }

      if (url === '/api/admin/tenant' && method === 'GET') {
        setCors();
        const tenantCtx = resolveTenantContext({
          headers: req.headers as Record<string, string | string[] | undefined>,
        });
        writeJson(res, 200, {
          tenantId: tenantCtx.tenantId,
          tenantSource: tenantCtx.source,
          multiTenantMode: isMultiTenantModeEnabled(),
          policyPath: process.env['GUARDIAN_POLICY_PATH'] || process.env['MCP_GUARDIAN_POLICY_PATH'] || 'default-policy.yaml',
        });
        return;
      }

      if (url === '/api/admin/audit-trail' && method === 'GET') {
        setCors();
        const { readFileSync: rfs, existsSync: ex } = await import('fs');
        const { resolveTenantPolicyAuditPath } = await import('../tenant/swarm-tenant-paths.js');
        const tenantAuditPath = resolveTenantPolicyAuditPath(requestTenantId);
        let entries: unknown[] = [];
        if (ex(tenantAuditPath)) {
          try {
            entries = rfs(tenantAuditPath, 'utf-8')
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((l) => JSON.parse(l));
          } catch {
            entries = [];
          }
        } else {
          const { getPolicyAuditor } = await import('./enterprise-bootstrap.js');
          const auditor = getPolicyAuditor();
          entries = auditor?.readAuditTrail() || [];
        }
        writeJson(res, 200, { entries, tenantId: requestTenantId });
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
          roles,
          authRequired,
          authConfigured: auth.isConfigured(),
          sessionTenantId: authResult.sessionTenantId ?? requestTenantId,
          multiTenantMode: isMultiTenantModeEnabled(),
          tenantLocked: isMultiTenantModeEnabled() && !!authResult.sessionTenantId,
          ...licenseStatusPayload(),
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
        if (!assertFeature(url, 'ai', res, setCors)) return;
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
            writeJson(res, 200, available({ suggestions: (report as any)?.suggestions || [], report }));
            return;
          }
        } catch { /* fall through */ }
        writeJson(res, 200, unavailable({ suggestions: [] }, 'AI engine not initialized — start proxy with GUARDIAN_AI_ENABLED')); return;
      }

      if (url === '/api/ai/report' && method === 'GET') {
        setCors();
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const engine = getAiEngine();
          if (engine) {
            const report = await engine.generateReport();
            writeJson(res, 200, available({ report }));
            return;
          }
        } catch { /* fall through */ }
        writeJson(res, 200, unavailable({ report: null }, 'AI engine not initialized')); return;
      }

      if (url === '/api/ai/state' && method === 'GET') {
        setCors();
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const engine = getAiEngine();
          if (engine) {
            const si = engine.getSelfImprovement();
            const s = si.getState();
            writeJson(res, 200, available({
              initialized: true,
              state: {
                adaptiveThreshold: s.adaptiveThreshold,
                truePositiveRate: s.truePositiveRate,
                falsePositiveRate: s.falsePositiveRate,
                moduleWeights: s.moduleWeights,
                lastUpdated: s.lastUpdated ?? null,
              },
            }));
            return;
          }
          const { resolveAiLearningStatePath } = await import('../ai/ai-paths.js');
          const statePath = resolveAiLearningStatePath(requestTenantId);
          if (existsSync(statePath)) {
            const s = JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
            writeJson(res, 200, available({
              initialized: true,
              state: {
                adaptiveThreshold: s.adaptiveThreshold ?? null,
                truePositiveRate: s.truePositiveRate ?? null,
                falsePositiveRate: s.falsePositiveRate ?? null,
                moduleWeights: s.moduleWeights ?? {},
                lastUpdated: s.lastUpdated ?? null,
              },
            }));
            return;
          }
        } catch { }
        writeJson(res, 200, unavailable({ initialized: false, state: null }, 'No AI learning state yet — proxy blocks populate learning'));
        return;
      }

      if (url === '/api/ai/baselines' && method === 'GET') {
        setCors();
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const engine = getAiEngine();
          if (engine) {
            writeJson(res, 200, available({ baselines: engine.getBaselineLearner().getAllBaselines() }));
            return;
          }
          const { resolveAiBaselinesPath } = await import('../ai/ai-paths.js');
          const bp = resolveAiBaselinesPath(requestTenantId);
          if (existsSync(bp)) {
            const raw = JSON.parse(readFileSync(bp, 'utf-8')) as { baselines?: unknown[] };
            writeJson(res, 200, available({ baselines: raw.baselines ?? [] }));
            return;
          }
        } catch { }
        writeJson(res, 200, unavailable({ baselines: [] }, 'No baselines learned yet'));
        return;
      }

      if (url === '/api/ai/threats' && method === 'GET') {
        setCors();
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const { startThreatIntelPollingIfEnabled } = await import('../ai/threat-intel.js');
          const engine = getAiEngine();
          const threatIntel = engine?.getThreatIntel() ?? startThreatIntelPollingIfEnabled();
          writeJson(res, 200, threatIntel.getStatus());
          return;
        } catch { }
        writeJson(res, 200, {
          threats: 0,
          knownIds: [],
          entries: [],
          updated: null,
          lastPollAt: null,
          pollingActive: false,
          pollingDisabled: process.env.GUARDIAN_AI_DISABLE_THREAT_POLL === 'true',
        });
        return;
      }

      if (url === '/api/ai/threats/poll' && method === 'POST') {
        setCors();
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const { startThreatIntelPollingIfEnabled } = await import('../ai/threat-intel.js');
          const engine = getAiEngine();
          const threatIntel = engine?.getThreatIntel() ?? startThreatIntelPollingIfEnabled();
          await threatIntel.pollLiveFeeds();
          writeJson(res, 200, threatIntel.getStatus());
          return;
        } catch (err) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Threat intel poll failed',
          });
          return;
        }
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
          if (!db) {
            writeJson(res, 200, unavailable({
              totalInstances: 0, activeInstances: 0, totalRequests: 0,
              blockedRequests: 0, passedRequests: 0, totalCost: 0, avgLatencyMs: 0,
              activeServers: 0, passRate: null, burnRatePerHour: null, lastUpdated: null,
            }, 'No history database — start proxy with MCP_GUARDIAN_DB_PATH'));
            return;
          }
          const srvs = await getAllActiveServerNames(db, requestTenantId);
          const records = await loadAllCallRecords(db, srvs, requestTenantId);
          const sum = summarizeRecords(records);
          const avgLatency = sum.total > 0 ? Math.round(sum.totalLatency / sum.total) : 0;
          const passRate = sum.total > 0 ? Math.round((sum.passed / sum.total) * 100) : null;
          writeJson(res, 200, available({
            totalInstances: 1, activeInstances: 1, totalRequests: sum.total,
            blockedRequests: sum.blocked, passedRequests: sum.passed, totalCost: sum.costUsd,
            avgLatencyMs: avgLatency, activeServers: srvs.length, passRate,
            burnRatePerHour: sum.total > 0 ? (sum.costUsd / sum.total) * 100 : null,
            lastUpdated: new Date().toISOString(),
          }));
        } catch {
          writeJson(res, 200, unavailable({ totalRequests: 0 }, 'Failed to read metrics'));
        }
        return;
      }

      if (url === '/api/aggregate/audit' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable({
              events: [], total: 0, blocked: 0, passed: 0, flagged: 0,
            }, 'No history database connected'));
            return;
          }
          const q = new URL(req.url || url, 'http://localhost').searchParams;
          const limit = Math.min(200, Math.max(1, parseInt(q.get('limit') || '50', 10) || 50));
          const actionFilter = q.get('action') || '';
          const serverFilter = q.get('server') || '';

          const srvs = await getAllActiveServerNames(db, requestTenantId);
          let records = await loadAllCallRecords(db, srvs, requestTenantId);
          if (serverFilter) {
            records = records.filter((r) => r.serverName === serverFilter);
          }
          if (actionFilter === 'block') {
            records = records.filter((r) => r.blocked);
          } else if (actionFilter === 'pass') {
            records = records.filter((r) => !r.blocked);
          }
          const sorted = [...records].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
          const evts = sorted.slice(0, limit).map((r) => ({
            timestamp: r.timestamp,
            server_name: r.serverName,
            tool_name: r.toolName,
            action: r.blocked ? 'block' : 'pass',
            rule: r.blockRule,
            reason: r.blockReason,
            request_tokens: r.requestTokens,
            response_tokens: r.responseTokens,
            total_tokens: r.totalTokens,
            duration_ms: r.durationMs,
          }));
          const blocked = records.filter((r) => r.blocked).length;

          let flagged = 0;
          let semanticAudit = { queued: 0, processed: 0, flagged: 0, enabled: false };
          try {
            const { loadSemanticAuditRecordsAsync } = await import('../ai/semantic-audit-store.js');
            const sem = await loadSemanticAuditRecordsAsync({
              limit: 500,
              tenantId: requestTenantId,
            });
            flagged = sem.filter(
              (r) => r.semanticAudit?.suspicious || r.label === 'true_positive',
            ).length;
            semanticAudit = {
              queued: sem.filter((r) => !r.label && !r.labeled).length,
              processed: sem.filter((r) => r.label || r.labeled).length,
              flagged,
              enabled: process.env['GUARDIAN_SEMANTIC_ASYNC'] === 'true',
            };
          } catch {
            /* non-fatal */
          }

          writeJson(res, 200, available({
            events: evts,
            total: records.length,
            blocked,
            passed: records.length - blocked,
            flagged,
            semanticAudit,
          }));
        } catch {
          writeJson(res, 200, unavailable({
            events: [], total: 0, blocked: 0, passed: 0, flagged: 0,
          }, 'Failed to read audit trail'));
        }
        return;
      }

      if (url === '/api/security' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable({
              serverReports: [], overallScore: null, worstOffenders: [], activeThreats: 0,
            }, 'No history database connected'));
            return;
          }
          const srvs = await getAllActiveServerNames(db, requestTenantId);
          const reps: any[] = [];
          let ts = 0;
          let scanned = 0;
          let activeThreats = 0;
          let lastScan: string | null = null;
          for (const srv of srvs) {
            const sc = await db.getLatestSecurityScan(srv, requestTenantId);
            if (sc) {
              const row = securityRowFromScan(sc as Record<string, unknown>, srv);
              reps.push({ ...row, scanned: true });
              ts += row.score;
              scanned += 1;
              activeThreats += row.critical + row.high;
              const at = (sc as { created_at?: string }).created_at;
              if (at && (!lastScan || at > lastScan)) lastScan = at;
            } else {
              reps.push({ name: srv, scanned: false, score: null, cves: null, critical: null, high: null, auth: null });
            }
          }
          writeJson(res, 200, available({
            serverReports: reps,
            overallScore: scanned > 0 ? Math.round(ts / scanned) : null,
            worstOffenders: reps.filter((r: any) => r.scanned && r.score != null && r.score < 50).map((r: any) => r.name),
            activeThreats,
            lastScan,
          }));
        } catch {
          writeJson(res, 200, unavailable({ serverReports: [], overallScore: null, worstOffenders: [], activeThreats: 0 }, 'Failed to read security scans'));
        }
        return;
      }

      if (url === '/api/cost' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable({
              serverReports: [], totalCost: null, projectedMonthly: null, budgetAlerts: [],
            }, 'No history database connected'));
            return;
          }
          const srvs = await getAllActiveServerNames(db, requestTenantId);
          const reps: any[] = [];
          let totalCost = 0;
          const { getRuntimeModelPricing } = await import('../services/runtime-model-pricing.js');
          const active = await getRuntimeModelPricing().getActivePricing();
          for (const srv of srvs) {
            const recs = await db.getCallRecordsForServer(srv, undefined, requestTenantId);
            const sum = summarizeRecords(recs);
            reps.push({ name: srv, tokens: sum.totalInput + sum.totalOutput, cost: sum.costUsd, trend: computeCostTrend(recs), unpriced: sum.unpricedCalls });
            totalCost += sum.costUsd;
          }
          const pricingModel = active
            ? `${active.displayName} (${active.source})`
            : 'per-call stored rates';
          const budgetUsd = parseCostBudgetUsd();
          const budgetAlerts: string[] = [];
          if (budgetUsd != null && totalCost > budgetUsd) {
            budgetAlerts.push(`Spend $${totalCost.toFixed(4)} exceeds budget $${budgetUsd.toFixed(2)}`);
          }
          writeJson(res, 200, available({
            serverReports: reps,
            totalCost,
            projectedMonthly: totalCost > 0 ? totalCost * 30 : null,
            budgetAlerts,
            pricingModel,
          }));
        } catch {
          writeJson(res, 200, unavailable({ serverReports: [], totalCost: null, projectedMonthly: null }, 'Failed to read cost data'));
        }
        return;
      }

      if (url === '/api/health' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable({
              serverReports: [], atRisk: [], avgLatency: null, totalTools: 0,
            }, 'No history database connected'));
            return;
          }
          const srvs = await getAllActiveServerNames(db, requestTenantId); const reps: any[] = []; let totalTools = 0; let latSum = 0; let latCount = 0;
          const cbStates = await fetchCircuitBreakerStates();
          for (const srv of srvs) {
            const recs = await db.getCallRecordsForServer(srv, undefined, requestTenantId);
            const callLat = recs.length > 0 ? Math.round(recs.reduce((s: number, r: any) => s + (r.durationMs || 0), 0) / recs.length) : 0;
            const sr = await db.getRecentSuccessRate(srv, requestTenantId);
            let latency = callLat;
            let tools = 0;
            if (typeof db.getLatestHealthCheck === 'function') {
              const hc = await db.getLatestHealthCheck(srv, requestTenantId);
              if (hc) {
                latency = hc.latency_ms ?? hc.latencyMs ?? callLat;
                tools = hc.tool_count ?? hc.toolCount ?? 0;
              }
            }
            totalTools += tools;
            if (latency > 0) { latSum += latency; latCount++; }
            reps.push({
              name: srv,
              latency,
              successRate: sr != null ? sr * 100 : null,
              tools,
              circuitBreaker: cbStates.get(srv) ?? 'closed',
              hasHealthData: sr != null || tools > 0,
            });
          }
          const avgLatency = latCount > 0 ? Math.round(latSum / latCount) : null;
          const atRisk = reps.filter((h: any) =>
            (h.latency != null && h.latency > 200) || (h.successRate != null && h.successRate < 70),
          ).map((h: any) => h.name);
          writeJson(res, 200, available({ serverReports: reps, atRisk, avgLatency, totalTools }));
        } catch {
          writeJson(res, 200, unavailable({ serverReports: [], atRisk: [], avgLatency: null, totalTools: 0 }, 'Failed to read health data'));
        }
        return;
      }

      if (url === '/api/instances' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb;
          let sum = { total: 0, blocked: 0, costUsd: 0, totalLatency: 0 };
          if (db) {
            const srvs = await getAllActiveServerNames(db, requestTenantId);
            const records = await loadAllCallRecords(db, srvs, requestTenantId);
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
      if (url === '/api/learning/semantic/outcomes' && method === 'GET') {
        setCors();
        const { loadSemanticAuditRecordsAsync } = await import('../ai/semantic-audit-store.js');
        const records = await loadSemanticAuditRecordsAsync({
          limit: 200,
          tenantId: requestTenantId,
        });
        writeJson(res, 200, { records, total: records.length });
        return;
      }

      if (url === '/api/learning/label' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const userId = authResult.identity || String(body.userId || 'dashboard');
        const label = String(body.label || '') as 'true_positive' | 'false_positive' | 'ignored';

        if (body.semanticAuditId) {
          const { labelSemanticAuditRecord } = await import('../ai/semantic-audit-store.js');
          const ok = await labelSemanticAuditRecord(
            String(body.semanticAuditId),
            label,
            userId,
            requestTenantId,
          );
          if (!ok) {
            writeJson(res, 404, { error: 'Semantic audit record not found' });
            return;
          }
          if (label === 'false_positive' || label === 'true_positive') {
            try {
              const { getAiEngine } = await import('../ai/suggestion-engine.js');
              const engine = getAiEngine();
              const si = engine?.getSelfImprovement();
              if (si) {
                si.recordOutcome(
                  {
                    suggestionId: String(body.semanticAuditId),
                    ruleName: String(body.ruleName || 'async-semantic'),
                    source: 'pattern',
                    action: label === 'true_positive' ? 'applied' : 'rejected',
                    confidence: typeof body.confidence === 'number' ? body.confidence : 0.7,
                    timestamp: new Date().toISOString(),
                    userId,
                  },
                  { userId, pattern: body.pattern ? String(body.pattern) : undefined },
                );
              }
            } catch {
              /* non-fatal */
            }
          }
          writeJson(res, 200, { status: 'labeled', id: body.semanticAuditId, label });
          return;
        }

        if (body.suggestionId) {
          const ruleName = String(body.ruleName || body.suggestionId);
          const source = (body.source as 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern' | 'attack') || 'pattern';
          const confidence = typeof body.confidence === 'number' ? body.confidence : 0.5;
          if (label === 'ignored') {
            const { getAiEngine } = await import('../ai/suggestion-engine.js');
            const si = getAiEngine()?.getSelfImprovement();
            si?.recordOutcome(
              {
                suggestionId: String(body.suggestionId),
                ruleName,
                source,
                action: 'ignored',
                confidence,
                timestamp: new Date().toISOString(),
                userId,
              },
              { userId, pattern: body.pattern ? String(body.pattern) : undefined },
            );
          } else {
            const { recordSuggestionOutcome } = await import('../ai/suggestion-engine.js');
            const action = label === 'true_positive' ? 'applied' : 'rejected';
            await recordSuggestionOutcome(String(body.suggestionId), action, {
              ruleName,
              source,
              confidence,
              userId,
              pattern: body.pattern ? String(body.pattern) : undefined,
            });
          }
          writeJson(res, 200, { status: 'labeled', id: body.suggestionId, label });
          return;
        }

        writeJson(res, 400, { error: 'semanticAuditId or suggestionId required' });
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
      if (url.startsWith('/api/flow/session') && method === 'GET') {
        setCors();
        try {
          const q = new URL(req.url || url, 'http://localhost').searchParams;
          const sessionKey = q.get('sessionKey') || q.get('requestId') || '';
          if (!sessionKey) {
            writeJson(res, 400, { error: 'sessionKey or requestId required' });
            return;
          }
          const { getFlowHistory } = await import('../policy/session-flow-store.js');
          const events = await getFlowHistory(sessionKey);
          writeJson(res, 200, { sessionKey, events });
        } catch (err: unknown) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Failed to load session flow',
          });
        }
        return;
      }

      if (url === '/api/logs' && method === 'GET') {
        setCors();
        const lines: string[] = [];
        const { getEffectiveSwarmDir } = await import('../tenant/swarm-tenant-paths.js');
        const jobLog = join(getEffectiveSwarmDir(requestTenantId), 'job.log');
        if (existsSync(jobLog)) {
          const tail = readFileSync(jobLog, 'utf-8').split('\n').filter(Boolean).slice(-80);
          lines.push(...tail.map((l) => `[swarm] ${l}`));
        }
        writeJson(res, 200, { logs: lines, total: lines.length });
        return;
      }

      if (url.startsWith('/api/security-swarm/')) {
        if (!assertFeature(url, 'swarm', res, setCors)) return;
      }

      if (url === '/api/security-swarm/run' && method === 'POST') {
        setCors();
        const body = await readBody(req).catch(() => ({}));
        const { startSwarmAnalysis } = await import('./security-swarm-runner.js');
        const result = startSwarmAnalysis({
          full: !!(body as { full?: boolean }).full,
          tenantId: requestTenantId,
        });
        if (!result.ok) {
          writeJson(res, result.status ?? 409, {
            error: result.error,
            jobId: result.jobId,
          });
          return;
        }
        writeJson(res, 202, { jobId: result.jobId, startedAt: result.startedAt });
        return;
      }
      if (url === '/api/security-swarm/status' && method === 'GET') {
        setCors();
        const { getSwarmJobStatus } = await import('./security-swarm-runner.js');
        writeJson(res, 200, getSwarmJobStatus(requestTenantId));
        return;
      }
      if (
        url === '/api/security-swarm/report' ||
        url === '/api/security-swarm/report/download'
      ) {
        setCors();
        const { readAnalysisReport } = await import('./security-swarm-runner.js');
        const report = readAnalysisReport(requestTenantId);
        if (!report.ok || !report.text) {
          writeJson(res, 404, { error: report.error || 'Report not ready' });
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        if (url.endsWith('/download')) {
          res.setHeader(
            'Content-Disposition',
            'attachment; filename="mcp-guardian-swarm-analysis.txt"',
          );
        }
        res.end(report.text);
        return;
      }
      if (url === '/api/security-swarm/latest' && method === 'GET') {
        setCors();
        const { readSwarmLatest } = await import('./security-swarm-runner.js');
        const latest = readSwarmLatest(requestTenantId);
        if (!latest) {
          writeJson(res, 404, { error: 'latest.json not found — run analysis first' });
          return;
        }
        writeJson(res, 200, latest);
        return;
      }
      if (url === '/api/security-swarm/figures' && method === 'GET') {
        setCors();
        const { readFiguresManifest } = await import('./swarm-artifacts.js');
        const manifest = readFiguresManifest(requestTenantId);
        writeJson(res, 200, {
          generatedAt: manifest.generatedAt ?? null,
          figures: manifest.figures,
        });
        return;
      }
      if (url === '/api/visuals/live' && method === 'GET') {
        setCors();
        try {
          const { writeVisualsData } = await import('./export-visuals-data.js');
          const data = await writeVisualsData({
            tenantId: requestTenantId,
            historyDb: runtimeHistoryDb ?? undefined,
          }) as unknown as Record<string, unknown>;
          writeJson(res, 200, available(data));
        } catch (err: unknown) {
          writeJson(res, 500, {
            available: false,
            error: err instanceof Error ? err.message : 'Failed to load visuals data',
          });
        }
        return;
      }
      if (url === '/api/security-swarm/summary' && method === 'GET') {
        setCors();
        const { readSwarmSummaryMd } = await import('./security-swarm-runner.js');
        const md = readSwarmSummaryMd(requestTenantId);
        if (!md) {
          writeJson(res, 404, { error: 'summary.md not found' });
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.end(md);
        return;
      }
      if (url === '/api/security-swarm/live-session' && method === 'GET') {
        setCors();
        const { readLiveFilesystemSession } = await import('./swarm-artifacts.js');
        const live = readLiveFilesystemSession(requestTenantId);
        if (!live) {
          writeJson(res, 404, { error: 'No live session from current analysis — run security analysis first' });
          return;
        }
        writeJson(res, 200, live);
        return;
      }
      if (url === '/api/security-swarm/report-json' && method === 'GET') {
        setCors();
        const { ensurePlainEnglishReport } = await import('./swarm-artifacts.js');
        const report = ensurePlainEnglishReport(requestTenantId);
        if (!report) {
          writeJson(res, 404, { error: 'report.json not found — run analysis first' });
          return;
        }
        writeJson(res, 200, report);
        return;
      }
      if (url === '/api/security-swarm/traffic-summary' && method === 'GET') {
        setCors();
        const { readTrafficSummary } = await import('./swarm-artifacts.js');
        const traffic = readTrafficSummary(requestTenantId);
        if (!traffic) {
          writeJson(res, 404, { error: 'traffic-summary.json not found' });
          return;
        }
        writeJson(res, 200, traffic);
        return;
      }
      if (url === '/api/security-swarm/user-servers' && method === 'GET') {
        setCors();
        const { readUserServersSession } = await import('./swarm-artifacts.js');
        const session = readUserServersSession(requestTenantId);
        if (!session) {
          writeJson(res, 404, { error: 'user-servers-session.json not found' });
          return;
        }
        writeJson(res, 200, session);
        return;
      }
      if (url === '/api/onboarding/status' && method === 'GET') {
        setCors();
        const { getOnboardingStatus } = await import('./server-registry.js');
        writeJson(res, 200, await getOnboardingStatus());
        return;
      }
      if (url === '/api/servers/registry' && method === 'GET') {
        setCors();
        const { getServerRegistry } = await import('./server-registry.js');
        const servers = await getServerRegistry();
        writeJson(res, 200, { servers });
        return;
      }

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

  ws = new WsBroadcaster(server, {
    dashboardAuth: auth,
    requireLicense: isLicenseEnforcementEnabled(),
  });
  setWsBroadcaster(ws);
  if (runtimeHistoryDb) {
    wireDashboardWsProviders(ws, runtimeHistoryDb);
  }
  if (dashboardEnabled) {
    const pushMs = parseInt(process.env['GUARDIAN_WS_PUSH_INTERVAL_MS'] || '5000', 10);
    ws.startDataPushLoop(pushMs);
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
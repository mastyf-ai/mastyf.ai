import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, appendFileSync } from 'fs';
import { load } from 'js-yaml';
import { parsePolicyConfig } from '../policy/policy-schema.js';
import {
  type PolicySignatureEnvelope,
  signPolicyYaml,
  validateSignedPolicyYaml,
} from '../policy/policy-signature.js';
import { resolve, dirname, join, extname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import { LRUCache } from 'lru-cache';
import { Logger } from './logger.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import type { UiMcpServerConfig } from './mcp-server-config.js';
import {
  DashboardAuth,
  SESSION_COOKIE_NAME,
} from '../auth/dashboard-auth.js';
import {
  assertTenantAdminScope,
  canAccessRoute,
} from '../auth/dashboard-rbac.js';
import { resolveTenantContext, InvalidTenantIdError, isMultiTenantModeEnabled, DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
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
import {
  isCiLicenseBypass,
  isOpenCoreEnabled,
} from '../license/feature-tiers.js';
import { isCiTokenCached } from '../license/ci-token.js';
import { DEFAULT_CLOUD_CONSOLE_URL } from '../constants/cloud-url.js';
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
import { cachedDashboardQuery, dashboardQueryCacheKey } from './dashboard-query-cache.js';
import { computeBurnRatePerHour, computeProjectedMonthly } from './cost-metrics.js';
import { buildCostTimeseries, loadAllRecordsInWindow } from './cost-timeseries.js';
import { buildExecutiveSummary } from './dashboard-executive-summary.js';
import { buildDashboardInsights, type InsightScope } from './dashboard-insights.js';
import { buildAuditHeatmapBundle } from './audit-heatmap.js';
import { parseWindowDays, windowToLabel } from './time-buckets.js';
import { buildDashboardFleetResponse } from './dashboard-fleet-api.js';
import {
  listFederatedRegions,
  resolveFederatedChartDb,
  type FederatedQueryContext,
} from './federated-data-source.js';
import { initUnifiedDataReaderPool } from './unified-data-reader.js';
import { getAuditAttestationStatus } from './audit-attestation.js';
import { getFieldEncryptionStatus } from './field-encryption.js';
import { getPolicyAuditor } from './enterprise-bootstrap.js';
import { deletePolicyRule, listActiveRules, togglePolicyRule } from './policy-rule-ops.js';
import {
  isLegacyArtifactsAllowed,
  isSwarmArtifactVisibleForSession,
} from './swarm-session.js';

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

function scanTimestampMs(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function latestScanTimestamp(...candidates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const ms = scanTimestampMs(candidate);
    if (ms > bestMs) {
      bestMs = ms;
      best = candidate;
    }
  }
  return best;
}

/** Next static export (`out/`) when built; else legacy static files in `dashboard-spa/`. */
function dashboardSpaDir(deployRoot: string): string {
  const outDir = join(deployRoot, 'dashboard-spa', 'out');
  if (existsSync(join(outDir, 'index.html'))) return outDir;
  return join(deployRoot, 'dashboard-spa');
}

function isReactDashboardBuilt(deployRoot: string | null): boolean {
  if (!deployRoot) return false;
  return existsSync(join(deployRoot, 'dashboard-spa', 'out', 'index.html'));
}

function loadDashboardHtml(): string {
  const dir = deployDir();
  const spaIndex = dir ? join(dashboardSpaDir(dir), 'index.html') : '';
  const useSpa = process.env['MASTYF_AI_DASHBOARD_SPA'] !== 'false';
  if (useSpa && spaIndex && existsSync(spaIndex)) {
    return readFileSync(spaIndex, 'utf-8');
  }
  const legacy = dir ? join(dir, 'dashboard.html') : '';
  if (legacy && existsSync(legacy)) return readFileSync(legacy, 'utf-8');
  return '<!DOCTYPE html><html><body><h1>MCP Mastyf AI API</h1><p>See README for REST and WebSocket endpoints.</p></body></html>';
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
  let tenantId = DEFAULT_TENANT_ID;

  const legacyPrefix = '/reports/security-swarm/';
  const tenantPrefixMatch = url.match(/^\/reports\/tenants\/([a-zA-Z0-9][a-zA-Z0-9-]*)\/security-swarm\/(.+)$/);
  if (tenantPrefixMatch) {
    tenantId = tenantPrefixMatch[1];
    root = join(REPO_ROOT, 'reports', 'tenants', tenantPrefixMatch[1], 'security-swarm');
    rel = tenantPrefixMatch[2];
  } else if (url.startsWith(legacyPrefix)) {
    if (!isLegacyArtifactsAllowed()) return false;
    root = join(REPO_ROOT, 'reports', 'security-swarm');
    rel = url.slice(legacyPrefix.length);
  }
  if (!root || !rel || rel.includes('..')) return false;

  const filePath = join(root, rel);
  if (!existsSync(filePath)) return false;
  if (!isSwarmArtifactVisibleForSession(filePath, tenantId)) return false;

  const mime = SPA_MIME[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  if (method === 'HEAD') {
    res.end();
  } else {
    res.end(readFileSync(filePath));
  }
  return true;
}

const DOCS_ASSET_ALLOW = new Set([
  'llm-threat-discovery-architecture.png',
  'auto-threat-research-architecture.png',
  'security-swarm-architecture.png',
]);

function tryServeDocsAsset(url: string, res: ServerResponse, method: string = 'GET'): boolean {
  const prefix = '/docs/assets/';
  if (!url.startsWith(prefix)) return false;
  const name = url.slice(prefix.length);
  if (!name || name.includes('..') || name.includes('/') || !DOCS_ASSET_ALLOW.has(name)) {
    return false;
  }
  const filePath = join(REPO_ROOT, 'docs', 'assets', name);
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

export {
  setAgenticContainer,
  getAgenticContainer,
  ensureAgenticContainer,
  isAgenticDemoMode,
} from './agentic-container.js';
import { getAgenticContainer, ensureAgenticContainer, isAgenticDemoMode } from './agentic-container.js';

type DashboardHandle = {
  auth: DashboardAuth;
  server: ReturnType<typeof createServer>;
  ws: WsBroadcaster | null;
};

let activeDashboard: DashboardHandle | null = null;

let dashboardAiEnginePromise: Promise<void> | null = null;

function touchDashboardAiEngine(): Promise<void> {
  if (!runtimeHistoryDb) return Promise.resolve();
  if (!dashboardAiEnginePromise) {
    dashboardAiEnginePromise = (async () => {
      const { ensureAiEngineInitialized } = await import('../ai/suggestion-engine.js');
      await ensureAiEngineInitialized(runtimeHistoryDb);
    })().catch(() => {}).finally(() => {
      dashboardAiEnginePromise = null;
    });
  }
  return dashboardAiEnginePromise;
}

export function setDashboardDataSource(historyDb: any): void {
  runtimeHistoryDb = historyDb;
  const handle = activeDashboard;
  if (handle?.ws) {
    wireDashboardWsProviders(handle.ws, historyDb);
  }
  void touchDashboardAiEngine();
}

function parseRegionParam(q: URLSearchParams): string | undefined {
  const region = q.get('region')?.trim();
  return region || undefined;
}

async function resolveChartContext(
  tenantId: string | undefined,
  windowDays: number,
  region?: string,
): Promise<FederatedQueryContext> {
  return resolveFederatedChartDb(runtimeHistoryDb, tenantId, windowDays, region);
}

function mergeFedMeta(
  meta: Record<string, unknown> | undefined,
  fed: FederatedQueryContext,
): Record<string, unknown> {
  return {
    ...(meta || {}),
    dataSources: fed.dataSources,
    federatedMode: fed.mode,
    ...(fed.region ? { region: fed.region } : {}),
  };
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
  const wsEnabled = process.env['MASTYF_AI_WS_ENABLED'] !== 'false';

  if (licenseRequired && !licenseOk) {
    Logger.error('[license] Dashboard and WebSocket disabled — license enforcement failed');
    dashboardEnabled = false;
  }

  if (
    dashboardEnabled
    && isOpenCoreEnabled()
    && !isCiLicenseBypass()
    && !isCiTokenCached()
    && isLicenseEnforcementEnabled()
    && !licenseClient.hasFeature('dashboard')
  ) {
    Logger.error(
      '[license] DASHBOARD_ENABLED requires a valid cloud API key when MASTYF_AI_REQUIRE_LICENSE=true',
    );
    dashboardEnabled = false;
  }

  if (dashboardEnabled && process.env['DATABASE_URL']) {
    await initUnifiedDataReaderPool().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.warn(`[dashboard] Unified data reader pool init failed: ${msg}`);
    });
  }

  const deployRoot = deployDir();
  if (dashboardEnabled && deployRoot && !isReactDashboardBuilt(deployRoot)) {
    Logger.warn(
      '[dashboard] React dashboard not built — run pnpm dashboard:build (serving legacy static shell until out/ exists)',
    );
  }

  if (!dashboardEnabled && !wsEnabled) {
    Logger.debug('[dashboard] Dashboard/WS disabled (DASHBOARD_ENABLED or MASTYF_AI_WS_ENABLED)');
    setWsBroadcaster(null);
    return {
      auth: dashboardAuth || new DashboardAuth({ enabled: false }),
      server: createServer((_req, res) => { res.writeHead(200); res.end(); }),
      ws: null,
    };
  }

  function licenseStatusPayload() {
    const tier = licenseClient.getTier();
    const upgradeUrl = licenseClient.getCloudBillingUrl() ?? null;
    const openCore = isOpenCoreEnabled();

    if (!openCore && !isLicenseEnforcementEnabled()) {
      return {
        licensed: true,
        tier: 'pro' as const,
        licenseEnforced: false,
        licenseRequired: false,
        openCore: false,
        tenantSlug: licenseClient.getTenantSlug() ?? null,
        licenseStatus: 'not_enforced',
        cloudBillingUrl: null,
        upgradeUrl,
        features: [] as string[],
      };
    }

    const state = licenseClient.getState();
    const licensed = licenseClient.isLicensed();
    return {
      licensed,
      tier,
      licenseEnforced: openCore || isLicenseEnforcementEnabled(),
      licenseRequired: licenseRequired,
      openCore,
      tenantSlug: licenseClient.getTenantSlug() ?? null,
      licenseStatus: state?.status ?? (licensed ? 'active' : 'community'),
      cloudBillingUrl: licenseClient.getCloudBillingUrl() ?? null,
      upgradeUrl,
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
    if (isLicenseExemptPath(path)) return true;
    if (isCiLicenseBypass() || isCiTokenCached()) return true;
    if (!isLicenseEnforcementEnabled() && licenseClient.isLicensed()) return true;
    if (licenseClient.hasFeature('dashboard')) {
      return true;
    }
    setCors();
    writeJson(res, 402, {
      error: 'Dashboard feature not available for this deployment',
      ...licenseStatusPayload(),
    });
    return false;
  }

  function assertFeature(_path: string, feature: string, res: ServerResponse, setCors: () => void): boolean {
    if (licenseClient.hasFeature(feature)) return true;
    setCors();
    writeJson(res, 402, {
      error: `Feature not licensed: ${feature}`,
      ...licenseStatusPayload(),
    });
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

  function prefersHtml(req: IncomingMessage): boolean {
    const accept = req.headers.accept ?? '';
    return typeof accept === 'string' && accept.includes('text/html');
  }

  function writeCloudExchangeError(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    message: string,
  ): void {
    if (prefersHtml(req)) {
      const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const consoleUrl = `${DEFAULT_CLOUD_CONSOLE_URL}/dashboard`;
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Cloud SSO</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem"><h1>Cloud sign-in failed</h1><p>${safe}</p><p><a href="/">Back to dashboard</a> · <a href="${consoleUrl}">Cloud console</a></p></body></html>`);
      return;
    }
    writeJson(res, status, { error: message });
  }

  function getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      return (first || '').trim();
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  function appendThreatIntelActionAudit(action: Record<string, unknown>): void {
    try {
      const file = join(homedir(), '.mastyf-ai', 'threat-intel-actions.jsonl');
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(action)}\n`, 'utf-8');
    } catch {
      /* best effort */
    }
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
    const n = parseInt(process.env.MASTYF_AI_DASHBOARD_API_RATE_LIMIT || '600', 10);
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
      || path === '/api/security-swarm/auto-corpus'
      || path === '/api/security-swarm/threat-lab-candidates'
      || path === '/api/threat-discovery/status'
      || path.startsWith('/api/threat-discovery/candidates/')
      || path.startsWith('/docs/assets/')
      || path === '/api/onboarding/status'
      || path === '/api/setup/status'
      || path === '/api/setup/db-health'
      || path === '/api/setup/cloud-status'
      || path === '/api/analytics/summary'
      || path === '/api/security/dashboard'
      || path === '/api/autopilot/status'
      || path === '/api/reports/digests/latest'
      || path === '/api/servers/registry'
      || path === '/api/visuals/live'
      || path === '/api/agentic/status'
      || path.startsWith('/api/agentic/')
      || path.startsWith('/api/compliance/')
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
      if (tryServeDocsAsset(url, res, method)) {
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
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Tenant-Id, X-Mastyf-Ai-Tenant, X-CSRF-Token',
      });
      res.end(); return;
    }

    const setCors = () => applyCors(req, res);

    let requestTenantId = process.env['MASTYF_AI_TENANT_ID'] || 'default';
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
          writeCloudExchangeError(req, res, 400, 'token query parameter required');
          return;
        }

        if (!auth.hasJwtSessionAuth()) {
          writeCloudExchangeError(
            req,
            res,
            503,
            `Set DASHBOARD_JWT_SECRET or MASTYF_AI_CLOUD_JWT_SECRET on this Mastyf AI host (same value as cloud AUTH_SECRET). The cloud console at ${DEFAULT_CLOUD_CONSOLE_URL} does not need this — only self-hosted SSO.`,
          );
          return;
        }

        const controlPlaneUrl = loadLicenseClientConfig().controlPlaneUrl;
        if (!controlPlaneUrl) {
          writeCloudExchangeError(
            req,
            res,
            503,
            `MASTYF_AI_CONTROL_PLANE_URL not configured (set to ${DEFAULT_CLOUD_CONSOLE_URL})`,
          );
          return;
        }
        const exchanged = await licenseClient.exchangeCloudToken(exchangeToken);
        if (!exchanged?.sessionToken) {
          writeCloudExchangeError(req, res, 401, 'Invalid or expired exchange token');
          return;
        }

        const cloudPayload = verifyCloudSessionToken(exchanged.sessionToken);
        if (!cloudPayload) {
          writeCloudExchangeError(
            req,
            res,
            401,
            'Invalid cloud session token — MASTYF_AI_CLOUD_JWT_SECRET must match cloud AUTH_SECRET',
          );
          return;
        }

        try {
          const token = auth.createCloudSession(
            exchanged.tenantSlug ?? cloudPayload.tenantSlug,
            cloudPayload.identity,
            mapCloudRoles(cloudPayload.roles),
          );
          const csrfToken = auth.isCsrfEnforced() ? auth.issueCsrfToken() : undefined;
          const cookies = [auth.sessionSetCookieHeader(token)];
          if (csrfToken) cookies.push(auth.csrfSetCookieHeader(csrfToken));
          res.writeHead(302, { Location: '/', 'Set-Cookie': cookies });
          res.end();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Cloud session creation failed';
          writeCloudExchangeError(req, res, 503, msg);
        }
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

      // SPA assets also need no-cache to avoid stale builds
      if (url === '/' || url === '/dashboard.html') {
        setCors();
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
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

      if (url.startsWith('/api/') && url !== '/api/login') {
        const clientIp = getClientIp(req);
        res.on('finish', () => {
          void import('../audit/dashboard-access-log.js').then(({ appendDashboardAccessLog }) => {
            appendDashboardAccessLog({
              userId: authResult.identity || 'unknown',
              tenantId: requestTenantId,
              method,
              path: url.split('?')[0] || url,
              endpoint: url.split('?')[0] || url,
              status: res.statusCode || 0,
              ip: clientIp,
            });
          });
        });
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
        const sigPath = join(dirname(policyPath), `.${policyPath.split('/').pop()}.sig.json`);
        let yaml = '';
        let signature: PolicySignatureEnvelope | null = null;
        if (existsSync(policyPath)) {
          try {
            yaml = readFileSync(policyPath, 'utf-8');
          } catch {
            yaml = '';
          }
        }
        if (existsSync(sigPath)) {
          try {
            signature = JSON.parse(readFileSync(sigPath, 'utf-8')) as PolicySignatureEnvelope;
          } catch {
            signature = null;
          }
        }
        const mode = policyWatcher?.get()?.getMode() || 'audit';
        writeJson(res, 200, {
          mode,
          rules: yaml ? `${yaml.split('\n').length} lines` : 'No policy file',
          yaml,
          path: policyPath,
          signature,
        });
        return;
      }

      if (url === '/api/policy/rules' && method === 'GET') {
        setCors();
        const policyPath = defaultPolicyPath();
        if (!existsSync(policyPath)) {
          writeJson(res, 200, { rules: [], total: 0, enabled: 0, disabled: 0, path: policyPath });
          return;
        }
        const yaml = readFileSync(policyPath, 'utf-8');
        try {
          const rules = listActiveRules(yaml);
          writeJson(res, 200, {
            rules,
            total: rules.length,
            enabled: rules.filter((r) => r.enabled).length,
            disabled: rules.filter((r) => !r.enabled).length,
            path: policyPath,
          });
        } catch (err) {
          writeJson(res, 400, { error: 'Invalid policy YAML', details: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (url === '/api/policy/rules' && method === 'PATCH') {
        setCors();
        const body = (await readBody(req)) as { name?: string; enabled?: boolean };
        const name = String(body.name ?? '').trim();
        if (!name || typeof body.enabled !== 'boolean') {
          writeJson(res, 400, { error: 'name and enabled(boolean) are required' });
          return;
        }
        const policyPath = defaultPolicyPath();
        if (!existsSync(policyPath)) {
          writeJson(res, 404, { error: 'Policy file not found' });
          return;
        }
        const yaml = readFileSync(policyPath, 'utf-8');
        let nextYaml = '';
        try {
          nextYaml = togglePolicyRule(yaml, name, body.enabled);
          parsePolicyConfig(load(nextYaml));
        } catch (err) {
          writeJson(res, 400, { error: 'Failed to toggle policy rule', details: err instanceof Error ? err.message : String(err) });
          return;
        }
        try {
          const tmpPath = `${policyPath}.dashboard-${process.pid}.tmp`;
          writeFileSync(tmpPath, nextYaml.endsWith('\n') ? nextYaml : `${nextYaml}\n`, 'utf-8');
          renameSync(tmpPath, policyPath);
        } catch (err) {
          writeJson(res, 500, { error: 'Failed to write policy file', details: err instanceof Error ? err.message : String(err) });
          return;
        }
        const nextRules = listActiveRules(nextYaml);
        const warning = nextRules.filter((rule) => rule.enabled).length === 0
          ? 'All rules are disabled. This significantly reduces protections.'
          : undefined;
        writeJson(res, 200, {
          status: 'ok',
          message: `Rule ${name} ${body.enabled ? 'enabled' : 'disabled'}`,
          reloadStatus: 'watcher-auto-reload',
          warning,
        });
        const auditor = getPolicyAuditor();
        if (auditor) {
          auditor.record({
            timestamp: new Date().toISOString(),
            actor: String(req.headers['x-mastyf-ai-policy-approver'] || authResult.identity || 'dashboard'),
            change: 'policy_rule_toggle_via_dashboard',
            oldValue: auditor.computeHash(yaml),
            newValue: auditor.computeHash(nextYaml),
            sourceHash: auditor.computeHash(nextYaml),
          });
        }
        return;
      }

      if (url === '/api/policy/rules' && method === 'DELETE') {
        setCors();
        const body = (await readBody(req)) as { name?: string };
        const name = String(body.name ?? '').trim();
        if (!name) {
          writeJson(res, 400, { error: 'name is required' });
          return;
        }
        const policyPath = defaultPolicyPath();
        if (!existsSync(policyPath)) {
          writeJson(res, 404, { error: 'Policy file not found' });
          return;
        }
        const yaml = readFileSync(policyPath, 'utf-8');
        let nextYaml = '';
        try {
          nextYaml = deletePolicyRule(yaml, name);
          parsePolicyConfig(load(nextYaml));
        } catch (err) {
          writeJson(res, 400, { error: 'Failed to delete policy rule', details: err instanceof Error ? err.message : String(err) });
          return;
        }
        try {
          const tmpPath = `${policyPath}.dashboard-${process.pid}.tmp`;
          writeFileSync(tmpPath, nextYaml.endsWith('\n') ? nextYaml : `${nextYaml}\n`, 'utf-8');
          renameSync(tmpPath, policyPath);
        } catch (err) {
          writeJson(res, 500, { error: 'Failed to write policy file', details: err instanceof Error ? err.message : String(err) });
          return;
        }
        const nextRules = listActiveRules(nextYaml);
        const warning = nextRules.length === 0
          ? 'Policy has no rules after deletion.'
          : undefined;
        writeJson(res, 200, {
          status: 'ok',
          message: `Rule ${name} deleted`,
          reloadStatus: 'watcher-auto-reload',
          warning,
        });
        const auditor = getPolicyAuditor();
        if (auditor) {
          auditor.record({
            timestamp: new Date().toISOString(),
            actor: String(req.headers['x-mastyf-ai-policy-approver'] || authResult.identity || 'dashboard'),
            change: 'policy_rule_delete_via_dashboard',
            oldValue: auditor.computeHash(yaml),
            newValue: auditor.computeHash(nextYaml),
            sourceHash: auditor.computeHash(nextYaml),
          });
        }
        return;
      }

      if (url === '/api/policy' && method === 'PUT') {
        setCors();
        if (process.env['MASTYF_AI_POLICY_FOUR_EYES_REQUIRED'] === 'true') {
          const proposer = String(req.headers['x-mastyf-ai-policy-proposer'] || '').trim();
          const approver = String(req.headers['x-mastyf-ai-policy-approver'] || '').trim();
          const approvalExpiry = String(req.headers['x-mastyf-ai-policy-approval-expiry'] || '').trim();
          if (!proposer || !approver) {
            writeJson(res, 400, { error: 'four-eyes required: proposer and approver headers missing' });
            return;
          }
          if (proposer === approver) {
            writeJson(res, 403, { error: 'four-eyes violation: proposer and approver must differ' });
            return;
          }
          if (approvalExpiry && Date.now() > Date.parse(approvalExpiry)) {
            writeJson(res, 403, { error: 'approval expired' });
            return;
          }
        }
        const body = (await readBody(req)) as {
          yaml?: string;
          signature?: PolicySignatureEnvelope;
          autoSign?: boolean;
        };
        const yaml = String(body.yaml ?? '').trim();
        if (!yaml) {
          writeJson(res, 400, { error: 'yaml required' });
          return;
        }
        let parsed: unknown;
        try {
          parsed = load(yaml);
          parsePolicyConfig(parsed);
        } catch (err) {
          writeJson(res, 400, {
            error: 'Invalid policy YAML',
            details: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        const policyPath = defaultPolicyPath();
        const sigPath = join(dirname(policyPath), `.${policyPath.split('/').pop()}.sig.json`);
        let envelope: PolicySignatureEnvelope | undefined = body.signature;
        if (!envelope && body.autoSign) {
          const issuer = process.env['MASTYF_AI_POLICY_SIGNING_ISSUER'] || 'mastyf-ai-admin';
          const keyId = process.env['MASTYF_AI_POLICY_SIGNING_KEY_ID'] || 'default';
          const now = new Date().toISOString();
          envelope = signPolicyYaml(yaml, {
            issuer,
            keyId,
            issuedAt: now,
            expiresAt: process.env['MASTYF_AI_POLICY_SIGNING_EXPIRES_AT'],
          });
        }
        const sigCheck = validateSignedPolicyYaml(yaml, envelope);
        if (!sigCheck.ok) {
          writeJson(res, 400, { error: 'Policy signature validation failed', details: sigCheck.reason });
          return;
        }
        try {
          mkdirSync(dirname(policyPath), { recursive: true });
          const tmpPath = `${policyPath}.dashboard-${process.pid}.tmp`;
          writeFileSync(tmpPath, yaml.endsWith('\n') ? yaml : `${yaml}\n`, 'utf-8');
          renameSync(tmpPath, policyPath);
          if (envelope) {
            writeFileSync(sigPath, JSON.stringify(envelope, null, 2), 'utf-8');
          }
        } catch (err) {
          writeJson(res, 500, {
            error: 'Failed to write policy file',
            details: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        try {
          const { recordConfigProvenance } = await import('../agentic/provenance/config-provenance-chain.js');
          recordConfigProvenance({
            actor: String(req.headers['x-mastyf-ai-policy-approver'] || authResult.identity || 'dashboard'),
            eventType: 'policy_apply',
            resourcePath: policyPath,
            diff: { source: 'dashboard_put', mode: parsePolicyConfig(parsed).policy.mode },
          });
        } catch {
          /* best-effort */
        }
        writeJson(res, 200, {
          status: 'ok',
          path: policyPath,
          message: 'Policy saved; watcher reloads on file change',
        });
        const auditor = getPolicyAuditor();
        if (auditor) {
          auditor.record({
            timestamp: new Date().toISOString(),
            actor: String(req.headers['x-mastyf-ai-policy-approver'] || authResult.identity || 'dashboard'),
            change: 'policy_update_via_dashboard',
            newValue: auditor.computeHash(yaml),
            sourceHash: auditor.computeHash(yaml),
          });
        }
        return;
      }

      if (url === '/api/policy/reload' && method === 'POST') {
        setCors();
        writeJson(res, 200, { status: 'ok', message: 'Policy watcher auto-detects changes' }); return;
      }

      if (url === '/api/audit/attestation' && method === 'GET') {
        setCors();
        writeJson(res, 200, getAuditAttestationStatus());
        return;
      }

      if (url === '/api/security/encryption-status' && method === 'GET') {
        setCors();
        writeJson(res, 200, getFieldEncryptionStatus());
        return;
      }

      if (url === '/api/policy/test' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const { runPolicyTest } = await import('../cli/policy-test.js');
        const policyPath =
          process.env['MASTYF_AI_POLICY_PATH'] ||
          process.env['MASTYF_AI_POLICY_PATH'] ||
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

      if (url === '/api/policy/copilot' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const goal = String(body.goal || '').trim();
        if (!goal) {
          writeJson(res, 400, { error: 'goal required' });
          return;
        }
        const { generatePolicyCopilotSuggestion } = await import('../ai/policy-copilot.js');
        const suggestion = await generatePolicyCopilotSuggestion(goal, {
          availableTools: Array.isArray(body.availableTools) ? body.availableTools.map(String) : undefined,
          tenantId: requestTenantId,
        });
        if (!suggestion) {
          writeJson(res, 503, { error: 'Could not generate policy suggestion' });
          return;
        }
        writeJson(res, 200, suggestion);
        return;
      }

      if (url === '/api/policy/copilot/replay' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const rule = body.rule;
        if (!rule || typeof rule !== 'object') {
          writeJson(res, 400, { error: 'rule object required' });
          return;
        }
        const { replayDraftRuleAsync } = await import('../ai/policy-copilot.js');
        const replay = await replayDraftRuleAsync(rule as import('../policy/policy-types.js').PolicyRule, {
          tenantId: requestTenantId,
        });
        writeJson(res, 200, replay);
        return;
      }

      if (url === '/api/policy/copilot/counterfactual' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const { simulatePolicyCounterfactual } = await import('../ai/policy-counterfactual.js');
        const draftRule =
          body.rule && typeof body.rule === 'object' && 'name' in body.rule && 'action' in body.rule
            ? (body.rule as import('../policy/policy-types.js').PolicyRule)
            : undefined;
        const report = await simulatePolicyCounterfactual({
          draftRule,
          tenantId: requestTenantId,
          windowDays: Number(body.windowDays) || 14,
        });
        writeJson(res, 200, report);
        return;
      }

      {
        const { handleRoadmapApiRoutes } = await import('../dashboard/roadmap-routes.js');
        const handled = await handleRoadmapApiRoutes({
          url,
          method,
          req,
          res,
          tenantId: requestTenantId,
          writeJson,
          readBody,
          setCors,
        });
        if (handled) return;
      }

      if (url === '/api/incidents/investigate' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const triggerId = String(body.triggerId || body.semanticAuditId || '').trim();
        if (!triggerId) {
          writeJson(res, 400, { error: 'triggerId required' });
          return;
        }
        const { investigateIncident } = await import('../ai/incident-investigator.js');
        const triggerTypeRaw = body.triggerType;
        const triggerType =
          triggerTypeRaw === 'semantic_flag' ||
          triggerTypeRaw === 'repeat_block' ||
          triggerTypeRaw === 'swarm_bypass'
            ? triggerTypeRaw
            : undefined;
        const investigation = await investigateIncident({
          triggerId,
          triggerType,
          tenantId: requestTenantId,
          useLlm: body.useLlm !== false,
        });
        if (!investigation) {
          writeJson(res, 404, { error: 'Trigger record not found' });
          return;
        }
        writeJson(res, 200, investigation);
        return;
      }

      if (url === '/api/learning/semantic/active-learning' && method === 'GET') {
        setCors();
        const { loadSemanticAuditRecordsAsync } = await import('../ai/semantic-audit-store.js');
        const { buildActiveLearningReport } = await import('../ai/semantic-active-learning.js');
        const records = await loadSemanticAuditRecordsAsync({
          tenantId: requestTenantId,
          sinceMs: 30 * 24 * 60 * 60 * 1000,
          limit: 500,
        });
        writeJson(res, 200, buildActiveLearningReport(records));
        return;
      }

      if (url === '/api/learning/semantic/tribunal' && method === 'GET') {
        setCors();
        const { peekTribunalQueue } = await import('../ai/swarm-debate-tribunal.js');
        const { getTribunalJobStatus, loadTribunalReport } = await import('./tribunal-runner.js');
        const u = new URL(req.url || url, 'http://localhost');
        const limitRaw = parseInt(u.searchParams.get('limit') || '10', 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 25) : 10;
        const peekOnly = u.searchParams.get('peek') !== 'false';
        if (peekOnly) {
          const [queue, job, report] = await Promise.all([
            peekTribunalQueue({ tenantId: requestTenantId, limit }),
            Promise.resolve(getTribunalJobStatus(requestTenantId)),
            Promise.resolve(loadTribunalReport(requestTenantId)),
          ]);
          writeJson(res, 200, { job, report, queue });
          return;
        }
        const { buildTribunalReport } = await import('../ai/swarm-debate-tribunal.js');
        const report = await buildTribunalReport({
          tenantId: requestTenantId,
          limit,
          useLlm: u.searchParams.get('useLlm') !== 'false',
        });
        writeJson(res, 200, report);
        return;
      }

      if (url === '/api/learning/semantic/tribunal/run' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const limitRaw = parseInt(String(body.limit ?? '10'), 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 25) : 10;
        const { startTribunalJob } = await import('./tribunal-runner.js');
        const result = startTribunalJob(requestTenantId, {
          limit,
          useLlm: body.useLlm === true,
        });
        if (!result.ok) {
          writeJson(res, result.status ?? 409, { ok: false, error: result.error, jobId: result.jobId });
          return;
        }
        writeJson(res, 200, { ok: true, jobId: result.jobId, startedAt: result.startedAt });
        return;
      }

      if (url === '/api/dashboard/agent-abuse' && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const fed = await resolveChartContext(requestTenantId, windowDays);
          const db = fed.db;
          if (!db) {
            writeJson(res, 200, unavailable({ scores: [] }, 'No history database'));
            return;
          }
          const { loadAllRecordsInWindow } = await import('./cost-timeseries.js');
          const { loadSemanticAuditRecordsAsync } = await import('../ai/semantic-audit-store.js');
          const { computeAgentAbuseScores } = await import('./agent-abuse-score.js');
          const records = await loadAllRecordsInWindow(db, requestTenantId, windowDays);
          const semantics = await loadSemanticAuditRecordsAsync({
            tenantId: requestTenantId,
            sinceMs: windowDays * 24 * 60 * 60 * 1000,
            limit: 500,
          });
          const scores = computeAgentAbuseScores(records, semantics, { limit: 20 });
          writeJson(res, 200, available({ scores, windowDays }));
        } catch {
          writeJson(res, 200, unavailable({ scores: [] }, 'Failed agent abuse scores'));
        }
        return;
      }

      if (url === '/api/security-swarm/tool-integrity' && method === 'GET') {
        setCors();
        const { existsSync, readFileSync } = await import('fs');
        const { join } = await import('path');
        const reportPath = join(process.cwd(), 'reports', 'security-swarm', 'tool-watch.json');
        if (!existsSync(reportPath)) {
          writeJson(res, 200, { hasData: false, hint: 'Run SWARM_TOOL_WATCH=true pnpm security-swarm' });
          return;
        }
        const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
        writeJson(res, 200, { hasData: true, ...report });
        return;
      }

      if (url === '/api/security-swarm/shadow-red-team' && method === 'GET') {
        setCors();
        const { existsSync, readFileSync } = await import('fs');
        const { join } = await import('path');
        const reportPath = join(process.cwd(), 'reports', 'security-swarm', 'shadow-red-team.json');
        if (!existsSync(reportPath)) {
          writeJson(res, 200, {
            hasData: false,
            hint: 'Run pnpm security-swarm:shadow-red-team or SWARM_SHADOW_RED_TEAM=true',
          });
          return;
        }
        const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
        writeJson(res, 200, { hasData: true, ...report });
        return;
      }

      if (url === '/api/security-swarm/supply-chain' && method === 'GET') {
        setCors();
        const { loadToolBaseline } = await import('../ai/shadow-red-team.js');
        const { buildSupplyChainGraph } = await import('../ai/supply-chain-graph.js');
        const { loadToolCallCounts } = await import('../ai/supply-chain-loader.js');
        const baselines = loadToolBaseline();
        const u = new URL(req.url || url, 'http://localhost');
        const windowDays = parseInt(u.searchParams.get('window') || '7', 10);
        const callCounts = await loadToolCallCounts(requestTenantId, Number.isFinite(windowDays) ? windowDays : 7);
        const graph = buildSupplyChainGraph(baselines, callCounts);
        writeJson(res, 200, {
          hasData: baselines.length > 0,
          graph,
          callCounts,
          hint: baselines.length > 0 ? undefined : 'Run SWARM_TOOL_WATCH=true pnpm security-swarm to capture MCP server baselines',
        });
        return;
      }

      if (url === '/api/fleet/signature-hints' && method === 'GET') {
        setCors();
        const { buildLocalSignatureExchange } = await import('../utils/federated-signature-exchange.js');
        const exchange = await buildLocalSignatureExchange();
        writeJson(res, 200, exchange);
        return;
      }

      if (url === '/api/ai/compliance/report' && method === 'GET') {
        setCors();
        const u = new URL(req.url || url, 'http://localhost');
        const windowDays = parseInt(u.searchParams.get('window') || '7', 10);
        const { generateComplianceReport } = await import('../ai/compliance-copilot.js');
        const report = await generateComplianceReport({
          tenantId: requestTenantId,
          windowDays: Number.isFinite(windowDays) ? windowDays : 7,
          useLlm: u.searchParams.get('useLlm') !== 'false',
        });
        writeJson(res, 200, {
          report,
          markdown: report.exportFormats.markdown,
          json: report.exportFormats.json,
        });
        return;
      }

      if (url === '/api/ai/tenant-model/readiness' && method === 'GET') {
        setCors();
        const { checkTenantModelReadiness, routeSemanticModelForTenant } = await import('../ai/tenant-semantic-model.js');
        const readiness = await checkTenantModelReadiness(requestTenantId);
        const routing = routeSemanticModelForTenant(requestTenantId);
        writeJson(res, 200, { ...readiness, routing });
        return;
      }

      if (url === '/api/ai/tenant-model/train' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const action = body.action === 'train' ? 'train' : 'export';
        const { exportTenantTrainingDataset } = await import('../ai/tenant-model-export.js');
        const { checkTenantModelReadiness } = await import('../ai/tenant-semantic-model.js');

        if (action === 'train') {
          const readiness = await checkTenantModelReadiness(requestTenantId);
          if (!readiness.ready) {
            writeJson(res, 400, {
              error: readiness.message,
              readiness,
            });
            return;
          }
          if (process.env.MASTYF_AI_DASHBOARD_ALLOW_LORA_TRAIN !== 'true') {
            writeJson(res, 403, {
              error: 'Dashboard LoRA train disabled — set MASTYF_AI_DASHBOARD_ALLOW_LORA_TRAIN=true on the host',
              readiness,
            });
            return;
          }
          const { startTenantTrainJob } = await import('../ai/tenant-model-train-runner.js');
          const started = startTenantTrainJob(requestTenantId);
          if (!started.ok) {
            writeJson(res, started.status ?? 500, {
              error: started.error,
              jobId: started.jobId,
            });
            return;
          }
          writeJson(res, 202, {
            jobId: started.jobId,
            status: 'queued',
            readiness,
          });
          return;
        }

        const exported = await exportTenantTrainingDataset(requestTenantId);
        writeJson(res, 200, {
          action: 'export',
          readiness: exported.readiness,
          manifest: exported.manifest,
          exportPath: exported.exportPath,
          modelfilePath: exported.modelfilePath,
          manifestPath: exported.manifestPath,
          rowsExported: exported.rowsExported,
          fewShotExamples: exported.fewShotExamples,
          envHint: `MASTYF_AI_TENANT_SEMANTIC_MODEL=true MASTYF_AI_SEMANTIC_LOCAL_MODEL=${exported.manifest.modelName}`,
        });
        return;
      }

      if (url === '/api/ai/tenant-model/train/status' && method === 'GET') {
        setCors();
        const { getTenantTrainJobStatus } = await import('../ai/tenant-model-train-runner.js');
        writeJson(res, 200, getTenantTrainJobStatus(requestTenantId));
        return;
      }

      if (url === '/api/soar/playbooks' && method === 'GET') {
        setCors();
        const { loadPlaybooksFromPath, DEFAULT_PLAYBOOKS } = await import('../alerting/soar-playbooks.js');
        const playbooks = loadPlaybooksFromPath();
        writeJson(res, 200, {
          enabled: process.env.MASTYF_AI_SOAR_PLAYBOOKS === 'true',
          playbooks: playbooks.length ? playbooks : DEFAULT_PLAYBOOKS,
        });
        return;
      }

      if (url === '/api/soar/playbooks' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const { evaluatePlaybooks, loadPlaybooksFromPath } = await import('../alerting/soar-playbooks.js');
        const playbooks = loadPlaybooksFromPath();
        const event = (body.event && typeof body.event === 'object' ? body.event : body) as Record<string, unknown>;
        const matches = evaluatePlaybooks(event, playbooks);
        writeJson(res, 200, { matches });
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
          policyPath: process.env['MASTYF_AI_POLICY_PATH'] || process.env['MASTYF_AI_POLICY_PATH'] || 'default-policy.yaml',
        });
        return;
      }

      if (url === '/api/admin/audit-trail' && method === 'GET') {
        setCors();
        const { readTenantAuditJsonl } = await import('../audit/dashboard-access-log.js');
        const entries = readTenantAuditJsonl(requestTenantId, 'policy-audit.jsonl', { limit: 500 });
        writeJson(res, 200, { entries, tenantId: requestTenantId });
        return;
      }

      if (url === '/api/admin/access-log' && method === 'GET') {
        setCors();
        const { readDashboardAccessLog } = await import('../audit/dashboard-access-log.js');
        writeJson(res, 200, {
          entries: readDashboardAccessLog(requestTenantId, 500),
          tenantId: requestTenantId,
        });
        return;
      }

      if (url === '/api/audit/heatmap' && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db;
          if (!db) {
            writeJson(res, 200, unavailable({ cells: [] }, 'No history database'));
            return;
          }
          const records = await loadAllRecordsInWindow(db, requestTenantId, windowDays);
          const bundle = buildAuditHeatmapBundle(records, windowDays);
          writeJson(res, 200, available({ ...bundle, meta: mergeFedMeta(bundle.meta as Record<string, unknown>, fed) }));
        } catch {
          writeJson(res, 200, unavailable({ cells: [] }, 'Failed audit heatmap'));
        }
        return;
      }

      if (url === '/api/audit' && method === 'GET') {
        setCors();
        const u = new URL(req.url || url, 'http://localhost');
        const startTime = u.searchParams.get('startTime') || undefined;
        const endTime = u.searchParams.get('endTime') || undefined;
        const limitRaw = parseInt(u.searchParams.get('limit') || '200', 10);
        const limit = Math.min(Number.isFinite(limitRaw) ? limitRaw : 200, 1000);
        const kind = u.searchParams.get('kind') || 'policy';
        const { readTenantAuditJsonl } = await import('../audit/dashboard-access-log.js');
        const fileName =
          kind === 'access'
            ? 'dashboard-access.jsonl'
            : kind === 'session'
              ? 'session-audit.jsonl'
              : 'policy-audit.jsonl';
        writeJson(res, 200, {
          tenantId: requestTenantId,
          kind,
          entries: readTenantAuditJsonl(requestTenantId, fileName, {
            startTime,
            endTime,
            limit,
          }),
        });
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

      // ── AI APIs (set MASTYF_AI_AI_ENABLED=false to disable) ──
      if (url.startsWith('/api/ai/')) {
        if (!assertFeature(url, 'ai', res, setCors)) return;
        const { isAiLearningEnabled } = await import('./ai-enabled.js');
        if (!isAiLearningEnabled()) {
          setCors();
          writeJson(res, 503, { error: 'AI learning disabled. Set MASTYF_AI_AI_ENABLED=false to disable.' });
          return;
        }
        await touchDashboardAiEngine();
      }

      if (url.startsWith('/api/learning/')) {
        await touchDashboardAiEngine();
      }

      if (url === '/api/ai/suggestions' && method === 'GET') {
        setCors();
        try {
          const { getAiEngine, loadPendingSuggestions } = await import('../ai/suggestion-engine.js');
          const pending = loadPendingSuggestions(requestTenantId);
          const engine = getAiEngine();
          if (pending.length > 0 || engine) {
            writeJson(res, 200, available({ suggestions: pending, report: null }));
            return;
          }
        } catch { /* fall through */ }
        writeJson(res, 200, unavailable({ suggestions: [] }, 'AI engine not initialized — start proxy with MASTYF_AI_AI_ENABLED')); return;
      }

      if (url === '/api/ai/simulation-pack' && method === 'GET') {
        setCors();
        try {
          const serverNames = runtimeHistoryDb
            ? await getAllActiveServerNames(runtimeHistoryDb, requestTenantId)
            : [];
          const records = runtimeHistoryDb
            ? await loadAllCallRecords(runtimeHistoryDb, serverNames, requestTenantId)
            : [];
          const { loadSemanticAuditRecordsAsync } = await import('../ai/semantic-audit-store.js');
          const semantic = await loadSemanticAuditRecordsAsync({
            tenantId: requestTenantId,
            limit: 400,
            sinceMs: 14 * 24 * 60 * 60 * 1000,
          });
          const simulationInputs = semantic
            .filter((r) => r.argumentsSnapshot && Object.keys(r.argumentsSnapshot).length > 0)
            .map((r) => ({
              toolName: r.toolName,
              arguments: r.argumentsSnapshot,
              blocked: r.syncDecision?.action === 'block' || !!r.semanticAudit?.suspicious,
            }));
          const { buildTenantSimulationPack } = await import('../ai/tenant-simulation-pack.js');
          const pack = buildTenantSimulationPack(requestTenantId, simulationInputs as Array<{
            toolName?: string;
            arguments?: Record<string, unknown>;
            blocked?: boolean;
          }>);
          const toolFingerprint = pack.toolFingerprint.length > 0
            ? pack.toolFingerprint
            : (() => {
                const byTool = new Map<string, { calls: number; blocked: number }>();
                for (const r of records) {
                  const tool = (r as { toolName?: string }).toolName || 'unknown';
                  const cur = byTool.get(tool) || { calls: 0, blocked: 0 };
                  cur.calls += 1;
                  if ((r as { blocked?: boolean }).blocked) cur.blocked += 1;
                  byTool.set(tool, cur);
                }
                return [...byTool.entries()].map(([toolName, v]) => ({
                  toolName,
                  calls: v.calls,
                  blockedRate: v.calls > 0 ? Math.round((v.blocked / v.calls) * 1000) / 1000 : 0,
                })).sort((a, b) => b.calls - a.calls);
              })();
          writeJson(res, 200, available({
            ...pack,
            totalRecordsScanned: Math.max(pack.totalRecordsScanned, records.length),
            toolFingerprint,
          } as unknown as Record<string, unknown>));
        } catch (err: unknown) {
          writeJson(res, 500, { error: err instanceof Error ? err.message : 'simulation pack failed' });
        }
        return;
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
          await touchDashboardAiEngine();
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
        writeJson(res, 200, unavailable({ initialized: false, state: null }, 'No AI learning state yet — restart proxy or wait for learning warmup'));
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
          pollingDisabled: process.env.MASTYF_AI_AI_DISABLE_THREAT_POLL === 'true',
        });
        return;
      }

      if (url === '/api/ai/threats/quarantined' && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const daysRaw = parseInt(u.searchParams.get('days') || '30', 10);
          const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const { startThreatIntelPollingIfEnabled } = await import('../ai/threat-intel.js');
          const engine = getAiEngine();
          const threatIntel = engine?.getThreatIntel() ?? startThreatIntelPollingIfEnabled();
          writeJson(res, 200, { entries: threatIntel.listQuarantined(days), days });
          return;
        } catch (err) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Failed to read quarantined threats',
          });
          return;
        }
      }

      if (
        url === '/api/ai/threats/quarantine/policy'
        && (method === 'GET' || method === 'POST')
      ) {
        setCors();
        try {
          let id = '';
          let days = 30;
          let listSnapshot: Record<string, unknown> | undefined;
          if (method === 'GET') {
            const u = new URL(req.url || '/', 'http://localhost');
            id = String(u.searchParams.get('id') || '').trim();
            const daysRaw = parseInt(u.searchParams.get('days') || '30', 10);
            days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
          } else {
            const b = await readBody(req);
            id = String(b.id || '').trim();
            const daysRaw = parseInt(String(b.days || '30'), 10);
            days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
            listSnapshot =
              b.record && typeof b.record === 'object'
                ? (b.record as Record<string, unknown>)
                : undefined;
          }
          if (!id && !listSnapshot?.id) {
            writeJson(res, 400, { error: 'id required' });
            return;
          }
          const lookupId = id || String(listSnapshot?.id || '');
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const { startThreatIntelPollingIfEnabled } = await import('../ai/threat-intel.js');
          const { buildIntelQuarantinePolicyDetail } = await import('./quarantine-policy-detail.js');
          const engine = getAiEngine();
          const threatIntel = engine?.getThreatIntel() ?? startThreatIntelPollingIfEnabled();
          let record = threatIntel.listQuarantined(days).find((e) => e.id === lookupId);
          if (!record && listSnapshot) {
            record = {
              id: lookupId,
              source: (listSnapshot.source || 'custom') as 'OSV' | 'NVD' | 'GitHub' | 'custom',
              severity: (listSnapshot.severity || 'HIGH') as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
              description: String(listSnapshot.description || ''),
              remediation: String(listSnapshot.remediation || ''),
              publishedAt: String(listSnapshot.publishedAt || new Date().toISOString()),
              quarantinedAt: String(listSnapshot.quarantinedAt || new Date().toISOString()),
              operator: listSnapshot.operator ? String(listSnapshot.operator) : undefined,
              note: listSnapshot.note ? String(listSnapshot.note) : undefined,
              appliedRuleName: listSnapshot.appliedRuleName
                ? String(listSnapshot.appliedRuleName)
                : undefined,
              policyPath: listSnapshot.policyPath ? String(listSnapshot.policyPath) : undefined,
              affectedPackage: listSnapshot.affectedPackage
                ? String(listSnapshot.affectedPackage)
                : undefined,
              affectedPattern: listSnapshot.affectedPattern
                ? String(listSnapshot.affectedPattern)
                : undefined,
              signature: listSnapshot.signature ? String(listSnapshot.signature) : undefined,
            };
          }
          if (!record) {
            writeJson(res, 404, { error: 'Quarantined threat not found' });
            return;
          }
          writeJson(res, 200, buildIntelQuarantinePolicyDetail(record));
          return;
        } catch (err) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Failed to read quarantine policy detail',
          });
          return;
        }
      }

      if (url === '/api/ai/threats/dismiss' && method === 'POST') {
        setCors();
        const b = await readBody(req);
        const id = String(b.id || '').trim();
        if (!id) {
          writeJson(res, 400, { ok: false, error: 'id required' });
          return;
        }
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const { startThreatIntelPollingIfEnabled } = await import('../ai/threat-intel.js');
          const engine = getAiEngine();
          const threatIntel = engine?.getThreatIntel() ?? startThreatIntelPollingIfEnabled();
          const result = threatIntel.dismissThreat(id, authResult.identity || undefined, String(b.note || ''));
          if (!result.ok) {
            writeJson(res, 400, { ok: false, error: result.error || 'Dismiss failed' });
            return;
          }
          appendThreatIntelActionAudit({
            action: 'dismiss',
            id,
            note: b.note ? String(b.note) : undefined,
            operator: authResult.identity || null,
            tenantId: requestTenantId,
            timestamp: new Date().toISOString(),
          });
          writeJson(res, 200, { ok: true, id });
          return;
        } catch (err) {
          writeJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : 'Dismiss failed',
          });
          return;
        }
      }

      if (url === '/api/ai/threats/quarantine' && method === 'POST') {
        setCors();
        const b = await readBody(req);
        const id = String(b.id || '').trim();
        if (!id) {
          writeJson(res, 400, { ok: false, error: 'id required' });
          return;
        }
        try {
          const { getAiEngine, recordSuggestionOutcome } = await import('../ai/suggestion-engine.js');
          const { startThreatIntelPollingIfEnabled } = await import('../ai/threat-intel.js');
          const engine = getAiEngine();
          const threatIntel = engine?.getThreatIntel() ?? startThreatIntelPollingIfEnabled();
          const entry = threatIntel.getEntryById(id);
          if (!entry) {
            writeJson(res, 404, { ok: false, error: `Unknown threat id: ${id}` });
            return;
          }
          const suggestion = threatIntel
            .generateRules([entry])
            .find((s) => s.rule.action === 'block')
            ?? threatIntel.generateRules([entry])[0];
          if (!suggestion?.rule) {
            writeJson(res, 400, { ok: false, error: 'No policy rule generated for threat' });
            return;
          }
          const policyPath = process.env['MASTYF_AI_POLICY_PATH']
            || process.env['MASTYF_AI_POLICY_PATH']
            || 'default-policy.yaml';
          await recordSuggestionOutcome(`threat-quarantine:${id}`, 'applied', {
            ruleName: suggestion.rule.name,
            source: 'threat',
            confidence: suggestion.confidence,
            rule: suggestion.rule,
            policyPath,
            policyWatcher: policyWatcher ?? null,
            userId: authResult.identity || undefined,
          });
          const result = threatIntel.quarantineThreat(id, {
            operator: authResult.identity || undefined,
            note: b.note ? String(b.note) : undefined,
            appliedRuleName: suggestion.rule.name,
            policyPath,
          });
          if (!result.ok) {
            writeJson(res, 400, { ok: false, error: result.error || 'Quarantine failed' });
            return;
          }
          appendThreatIntelActionAudit({
            action: 'quarantine',
            id,
            note: b.note ? String(b.note) : undefined,
            operator: authResult.identity || null,
            tenantId: requestTenantId,
            appliedRuleName: suggestion.rule.name,
            policyPath,
            timestamp: new Date().toISOString(),
          });
          writeJson(res, 200, { ok: true, id, appliedRuleName: suggestion.rule.name, record: result.record });
          return;
        } catch (err) {
          writeJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : 'Quarantine failed',
          });
          return;
        }
      }

      if (url === '/api/ai/threats/restore' && method === 'POST') {
        setCors();
        const b = await readBody(req);
        const id = String(b.id || '').trim();
        if (!id) {
          writeJson(res, 400, { ok: false, error: 'id required' });
          return;
        }
        try {
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const { startThreatIntelPollingIfEnabled } = await import('../ai/threat-intel.js');
          const engine = getAiEngine();
          const threatIntel = engine?.getThreatIntel() ?? startThreatIntelPollingIfEnabled();
          const result = threatIntel.restoreThreat(id);
          if (!result.ok) {
            writeJson(res, 400, { ok: false, error: result.error || 'Restore failed' });
            return;
          }
          appendThreatIntelActionAudit({
            action: 'restore',
            id,
            operator: authResult.identity || null,
            tenantId: requestTenantId,
            timestamp: new Date().toISOString(),
          });
          writeJson(res, 200, { ok: true, id });
          return;
        } catch (err) {
          writeJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : 'Restore failed',
          });
          return;
        }
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
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db;
          if (!db) {
            writeJson(res, 200, unavailable({
              totalInstances: 0, activeInstances: 0, totalRequests: 0,
              blockedRequests: 0, passedRequests: 0, totalCost: 0, avgLatencyMs: 0,
              activeServers: 0, passRate: null, burnRatePerHour: null, lastUpdated: null,
            }, 'No history database — start proxy with MASTYF_AI_DB_PATH'));
            return;
          }
          const records = await loadAllRecordsInWindow(db, requestTenantId, windowDays);
          const sum = summarizeRecords(records);
          const avgLatency = sum.total > 0 ? Math.round(sum.totalLatency / sum.total) : 0;
          const passRate = sum.total > 0 ? Math.round((sum.passed / sum.total) * 100) : null;
          const burnRatePerHour = computeBurnRatePerHour(sum.costUsd, records);
          writeJson(res, 200, available({
            totalInstances: 1, activeInstances: 1, totalRequests: sum.total,
            blockedRequests: sum.blocked, passedRequests: sum.passed, totalCost: sum.costUsd,
            avgLatencyMs: avgLatency, activeServers: new Set(records.map((r) => r.serverName)).size || 0,
            passRate,
            burnRatePerHour: sum.total > 0 ? burnRatePerHour : null,
            lastUpdated: new Date().toISOString(),
            meta: mergeFedMeta({
              window: windowToLabel(windowDays),
              windowDays,
              generatedAt: new Date().toISOString(),
              recordCount: records.length,
            }, fed),
          }));
        } catch {
          writeJson(res, 200, unavailable({ totalRequests: 0 }, 'Failed to read metrics'));
        }
        return;
      }

      if (url === '/api/aggregate/audit' && method === 'GET') {
        setCors();
        try {
          const q = new URL(req.url || url, 'http://localhost').searchParams;
          const limit = Math.min(200, Math.max(1, parseInt(q.get('limit') || '50', 10) || 50));
          const actionFilter = q.get('action') || '';
          const serverFilter = q.get('server') || '';
          const region = parseRegionParam(q);
          const windowDays = parseWindowDays(q.get('window') || '7');
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db;
          if (!db) {
            writeJson(res, 200, unavailable({
              events: [], total: 0, blocked: 0, passed: 0, flagged: 0,
            }, 'No history database connected'));
            return;
          }

          // Use the windowed loader so audit honors the dashboard window
          let records = await loadAllRecordsInWindow(db, requestTenantId, windowDays);
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
            const { isSemanticAsyncEnabledForTenant } = await import('../tenant/tenant-semantic-config.js');
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
              enabled: isSemanticAsyncEnabledForTenant(requestTenantId),
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
            meta: mergeFedMeta({ recordCount: records.length }, fed),
          }));
        } catch {
          writeJson(res, 200, unavailable({
            events: [], total: 0, blocked: 0, passed: 0, flagged: 0,
          }, 'Failed to read audit trail'));
        }
        return;
      }

      if (url === '/api/security/dashboard' && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '1');
          const fed = await resolveChartContext(requestTenantId, windowDays);
          const { buildSecurityDashboard } = await import('./security-dashboard.js');
          let policyMode: string | undefined;
          try {
            const { readFileSync } = await import('fs');
            const { load } = await import('js-yaml');
            const { parsePolicyConfig } = await import('../policy/policy-schema.js');
            const yaml = readFileSync(defaultPolicyPath(), 'utf-8');
            policyMode = parsePolicyConfig(load(yaml)).policy.mode;
          } catch {
            policyMode = process.env.MASTYF_AI_POLICY_MODE;
          }
          const payload = await buildSecurityDashboard(fed.db, requestTenantId, windowDays, { policyMode });
          writeJson(res, 200, payload.available ? available(payload) : unavailable(payload, payload.emptyReason || 'No data'));
        } catch {
          writeJson(res, 200, unavailable({ threats: [] }, 'Failed security dashboard'));
        }
        return;
      }

      if (url === '/api/security/threats/quarantined' && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const daysRaw = parseInt(u.searchParams.get('days') || '30', 10);
          const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
          const { getSecurityThreatQuarantine } = await import('./security-threat-quarantine.js');
          writeJson(res, 200, {
            entries: getSecurityThreatQuarantine(requestTenantId).list(days),
            days,
          });
        } catch (e) {
          writeJson(res, 500, {
            error: e instanceof Error ? e.message : 'Failed to read quarantined monitor threats',
          });
        }
        return;
      }

      if (
        url === '/api/security/threats/quarantine/policy'
        && (method === 'GET' || method === 'POST')
      ) {
        setCors();
        try {
          let threatKey = '';
          let displayId = '';
          let days = 30;
          let listSnapshot: Record<string, unknown> | undefined;
          if (method === 'GET') {
            const u = new URL(req.url || '/', 'http://localhost');
            threatKey = String(u.searchParams.get('threatKey') || '').trim();
            displayId = String(u.searchParams.get('id') || '').trim();
            const daysRaw = parseInt(u.searchParams.get('days') || '30', 10);
            days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
          } else {
            const b = await readBody(req);
            threatKey = String(b.threatKey || '').trim();
            displayId = String(b.id || '').trim();
            const daysRaw = parseInt(String(b.days || '30'), 10);
            days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
            listSnapshot =
              b.record && typeof b.record === 'object'
                ? (b.record as Record<string, unknown>)
                : undefined;
          }
          if (!threatKey && !displayId && !listSnapshot?.threatKey && !listSnapshot?.id) {
            writeJson(res, 400, { error: 'threatKey or id required' });
            return;
          }
          const { getSecurityThreatQuarantine } = await import('./security-threat-quarantine.js');
          const { buildMonitorQuarantinePolicyDetail } = await import('./quarantine-policy-detail.js');
          const store = getSecurityThreatQuarantine(requestTenantId);
          let record = store.findEntry(days, {
            threatKey: threatKey || String(listSnapshot?.threatKey || ''),
            id: displayId || String(listSnapshot?.id || ''),
          });
          if (!record && listSnapshot) {
            record = {
              id: String(listSnapshot.id || displayId || threatKey),
              threatKey: String(listSnapshot.threatKey || threatKey || displayId),
              type: String(listSnapshot.type || 'Policy violation'),
              source: String(listSnapshot.source || 'unknown'),
              severity: (['critical', 'high', 'medium', 'low'].includes(String(listSnapshot.severity))
                ? listSnapshot.severity
                : 'high') as 'critical' | 'high' | 'medium' | 'low',
              status: (['blocked', 'monitored', 'resolved'].includes(String(listSnapshot.status))
                ? listSnapshot.status
                : 'resolved') as 'blocked' | 'monitored' | 'resolved',
              quarantinedAt: String(listSnapshot.quarantinedAt || new Date().toISOString()),
              operator: listSnapshot.operator ? String(listSnapshot.operator) : undefined,
              note: listSnapshot.note ? String(listSnapshot.note) : undefined,
              appliedRuleName: listSnapshot.appliedRuleName
                ? String(listSnapshot.appliedRuleName)
                : undefined,
              policyPath: listSnapshot.policyPath ? String(listSnapshot.policyPath) : undefined,
              enforcementStatus: (listSnapshot.enforcementStatus || 'skipped') as
                | 'applied'
                | 'already_present'
                | 'already_blocked'
                | 'no_context'
                | 'skipped',
              enforcementDetail: listSnapshot.enforcementDetail
                ? String(listSnapshot.enforcementDetail)
                : undefined,
              sourceKind: (listSnapshot.sourceKind || 'unknown') as
                | 'semantic'
                | 'block'
                | 'unknown',
            };
          }
          if (!record) {
            writeJson(res, 404, { error: 'Quarantined monitor threat not found' });
            return;
          }
          const fed = await resolveChartContext(requestTenantId, 1);
          const detail = await buildMonitorQuarantinePolicyDetail(
            record,
            requestTenantId,
            fed.db,
          );
          writeJson(res, 200, detail);
        } catch (e) {
          writeJson(res, 500, {
            error: e instanceof Error ? e.message : 'Failed to read quarantine policy detail',
          });
        }
        return;
      }

      if (url === '/api/security/threats/restore' && method === 'POST') {
        setCors();
        const b = await readBody(req);
        const threatKey = String(b.threatKey || '').trim();
        const removeRule = b.removeRule === true || b.removeRule === 'true';
        if (!threatKey) {
          writeJson(res, 400, { ok: false, error: 'threatKey required' });
          return;
        }
        try {
          const { getSecurityThreatQuarantine } = await import('./security-threat-quarantine.js');
          const result = getSecurityThreatQuarantine(requestTenantId).restore(threatKey);
          if (!result.ok) {
            writeJson(res, 400, { ok: false, error: result.error || 'Restore failed' });
            return;
          }
          let removedRule = false;
          if (removeRule && result.record?.appliedRuleName) {
            const { removeSuggestionRuleFromPolicy } = await import('../ai/policy-applier.js');
            const removed = removeSuggestionRuleFromPolicy(
              result.record.appliedRuleName,
              result.record.policyPath || defaultPolicyPath(),
              policyWatcher ?? null,
            );
            removedRule = removed.removed;
          }
          appendThreatIntelActionAudit({
            action: 'monitor_restore',
            id: threatKey,
            appliedRuleName: result.record?.appliedRuleName,
            removeRule,
            removedRule,
            operator: authResult.identity || null,
            tenantId: requestTenantId,
            timestamp: new Date().toISOString(),
          });
          writeJson(res, 200, { ok: true, threatKey, removedRule });
        } catch (e) {
          writeJson(res, 500, { ok: false, error: e instanceof Error ? e.message : 'Restore failed' });
        }
        return;
      }

      if (url === '/api/security/threats/quarantine' && method === 'POST') {
        setCors();
        const b = await readBody(req);
        try {
          const { getSecurityThreatQuarantine } = await import('./security-threat-quarantine.js');
          const { applyMonitorQuarantineEnforcement } = await import('./monitor-quarantine-enforcement.js');
          const store = getSecurityThreatQuarantine(requestTenantId);
          const operator = authResult.identity || undefined;
          const policyPath = process.env['MASTYF_AI_POLICY_PATH']
            || process.env['MASTYF_AI_POLICY_PATH']
            || defaultPolicyPath();

          if (b.all === true || b.all === 'true') {
            const fed = await resolveChartContext(requestTenantId, 1);
            const { buildSecurityDashboard } = await import('./security-dashboard.js');
            let policyMode: string | undefined;
            try {
              const { readFileSync } = await import('fs');
              const { load } = await import('js-yaml');
              const { parsePolicyConfig } = await import('../policy/policy-schema.js');
              const yaml = readFileSync(defaultPolicyPath(), 'utf-8');
              policyMode = parsePolicyConfig(load(yaml)).policy.mode;
            } catch {
              policyMode = process.env.MASTYF_AI_POLICY_MODE;
            }
            const dash = await buildSecurityDashboard(fed.db, requestTenantId, 1, { policyMode });
            const targets = (dash.threats ?? []).filter(
              (t) => t.severity === 'critical' || t.severity === 'high',
            );
            let quarantined = 0;
            for (const row of targets) {
              const enforcement = await applyMonitorQuarantineEnforcement({
                row,
                tenantId: requestTenantId,
                db: fed.db,
                policyPath,
                policyWatcher: policyWatcher ?? null,
                operator,
              });
              const result = store.quarantine(row, operator, undefined, {
                appliedRuleName: enforcement.appliedRuleName,
                policyPath: enforcement.policyPath,
                enforcementStatus: enforcement.status,
                enforcementDetail: enforcement.detail,
                sourceKind: enforcement.sourceKind,
              });
              if (result.ok) quarantined += 1;
            }
            appendThreatIntelActionAudit({
              action: 'monitor_quarantine_all',
              count: quarantined,
              operator: authResult.identity || null,
              tenantId: requestTenantId,
              timestamp: new Date().toISOString(),
            });
            writeJson(res, 200, { ok: true, quarantined });
            return;
          }

          const threatKey = String(b.threatKey || '').trim();
          if (!threatKey) {
            writeJson(res, 400, { ok: false, error: 'threatKey required' });
            return;
          }
          const row = {
            threatKey,
            id: String(b.id || threatKey),
            type: String(b.type || 'Policy violation'),
            source: String(b.source || 'unknown'),
            severity: (['critical', 'high', 'medium', 'low'].includes(String(b.severity))
              ? b.severity
              : 'high') as 'critical' | 'high' | 'medium' | 'low',
            status: (['blocked', 'monitored', 'resolved'].includes(String(b.status))
              ? b.status
              : 'blocked') as 'blocked' | 'monitored' | 'resolved',
          };
          const fed = await resolveChartContext(requestTenantId, 1);
          const enforcement = await applyMonitorQuarantineEnforcement({
            row,
            tenantId: requestTenantId,
            db: fed.db,
            policyPath,
            policyWatcher: policyWatcher ?? null,
            operator,
          });
          const result = store.quarantine(row, operator, b.note ? String(b.note) : undefined, {
            appliedRuleName: enforcement.appliedRuleName,
            policyPath: enforcement.policyPath,
            enforcementStatus: enforcement.status,
            enforcementDetail: enforcement.detail,
            sourceKind: enforcement.sourceKind,
          });
          if (!result.ok) {
            writeJson(res, 400, { ok: false, error: result.error || 'Quarantine failed' });
            return;
          }
          appendThreatIntelActionAudit({
            action: 'monitor_quarantine',
            id: row.id,
            threatKey,
            appliedRuleName: enforcement.appliedRuleName,
            enforcementStatus: enforcement.status,
            operator: authResult.identity || null,
            tenantId: requestTenantId,
            timestamp: new Date().toISOString(),
          });
          writeJson(res, 200, {
            ok: true,
            threatKey,
            record: result.record,
            appliedRuleName: enforcement.appliedRuleName,
            enforcementStatus: enforcement.status,
          });
        } catch (e) {
          writeJson(res, 500, { ok: false, error: e instanceof Error ? e.message : 'Quarantine failed' });
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
          const { getSwarmJobStatus } = await import('./security-swarm-runner.js');
          const swarmFinishedAt = getSwarmJobStatus(requestTenantId).finishedAt;
          lastScan = latestScanTimestamp(lastScan, swarmFinishedAt);
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
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db;
          if (!db) {
            writeJson(res, 200, unavailable({
              serverReports: [], totalCost: null, projectedMonthly: null, budgetAlerts: [],
            }, 'No history database connected'));
            return;
          }
          const srvs = await getAllActiveServerNames(db, requestTenantId);
          const reps: any[] = [];
          let totalCost = 0;
          const cutoff = Date.now() - windowDays * 86400000;
          let windowRecords = await loadAllRecordsInWindow(db, requestTenantId, windowDays);
          const { repriceRecordsForDisplay, buildCostCoverage } = await import('./cost-coverage.js');
          const { recordsTimeSpanHours } = await import('./cost-metrics.js');
          const repriced = await repriceRecordsForDisplay(windowRecords);
          windowRecords = repriced.records;
          const costCoverage = buildCostCoverage(windowRecords);
          const { getRuntimeModelPricing } = await import('../services/runtime-model-pricing.js');
          const active = await getRuntimeModelPricing().getActivePricing();
          for (const srv of srvs) {
            const recs = await db.getCallRecordsForServer(srv, undefined, requestTenantId);
            const windowRecs = windowRecords.filter(
              (r) => r.serverName === srv && Date.parse(String(r.timestamp || '')) >= cutoff,
            );
            const sum = summarizeRecords(windowRecs);
            reps.push({ name: srv, tokens: sum.totalInput + sum.totalOutput, cost: sum.costUsd, trend: computeCostTrend(windowRecs), unpriced: sum.unpricedCalls });
            totalCost += sum.costUsd;
          }
          totalCost = costCoverage.measuredUsd;
          const spanHours = recordsTimeSpanHours(windowRecords);
          const burnRatePerHour = computeBurnRatePerHour(totalCost, windowRecords);
          let projectedMonthly = computeProjectedMonthly(totalCost, windowRecords);
          if (costCoverage.coveragePct < 50 || spanHours < 24) {
            projectedMonthly = 0;
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
            projectedMonthly: projectedMonthly > 0 ? projectedMonthly : null,
            burnRatePerHour,
            budgetUsd,
            budgetAlerts,
            pricingModel,
            costCoverage,
            disclaimer: costCoverage.disclaimer,
            windowDays,
            meta: mergeFedMeta({
              window: windowToLabel(windowDays),
              windowDays,
              generatedAt: new Date().toISOString(),
              recordCount: windowRecords.length,
            }, fed),
          }));
        } catch {
          writeJson(res, 200, unavailable({ serverReports: [], totalCost: null, projectedMonthly: null }, 'Failed to read cost data'));
        }
        return;
      }

      if (url === '/api/cost/breakdown' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable({ tools: [], windowDays: 7 }, 'No history database'));
            return;
          }
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = Math.min(90, Math.max(1, parseInt(u.searchParams.get('window') || '7', 10)));
          const cacheKey = dashboardQueryCacheKey({
            route: 'cost-breakdown',
            tenant: requestTenantId,
            window: windowDays,
          });
          const payload = await cachedDashboardQuery(cacheKey, async () => {
            const cutoff = Date.now() - windowDays * 86400000;
            const srvs = await getAllActiveServerNames(db, requestTenantId);
            const byTool = new Map<string, { calls: number; costUsd: number }>();
            for (const srv of srvs) {
              const recs = await db.getCallRecordsForServer(srv, undefined, requestTenantId);
              for (const r of recs) {
                const ts = Date.parse(String(r.timestamp || ''));
                if (!Number.isFinite(ts) || ts < cutoff) continue;
                const key = `${srv}:${r.toolName || 'unknown'}`;
                const cur = byTool.get(key) || { calls: 0, costUsd: 0 };
                cur.calls++;
                cur.costUsd += Number(r.costUsd) || 0;
                byTool.set(key, cur);
              }
            }
            const tools = [...byTool.entries()]
              .map(([key, v]) => {
                const [server, tool] = key.split(':');
                return { server, tool, calls: v.calls, costUsd: v.costUsd };
              })
              .sort((a, b) => b.costUsd - a.costUsd)
              .slice(0, 50);
            return available({ tenantId: requestTenantId, windowDays, tools });
          });
          writeJson(res, 200, payload);
        } catch {
          writeJson(res, 200, unavailable({ tools: [] }, 'Failed cost breakdown'));
        }
        return;
      }

      if (url === '/api/cost/recommendations' && method === 'GET') {
        setCors();
        try {
          const db = runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable({ recommendations: [], windowDays: 7 }, 'No history database'));
            return;
          }
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = Math.min(90, Math.max(1, parseInt(u.searchParams.get('window') || '7', 10)));
          const { buildCostRecommendations } = await import('./dashboard-cost-recommendations.js');
          const recommendations = await buildCostRecommendations(db, requestTenantId, windowDays);
          writeJson(res, 200, available({ tenantId: requestTenantId, windowDays, recommendations }));
        } catch {
          writeJson(res, 200, unavailable({ recommendations: [] }, 'Failed cost recommendations'));
        }
        return;
      }

      if (url === '/api/cost/timeseries' && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db;
          if (!db) {
            writeJson(res, 200, unavailable({ series: [], windowDays: 7 }, 'No history database'));
            return;
          }
          const gran = u.searchParams.get('granularity') === 'hour' ? 'hour' : 'day';
          const result = await buildCostTimeseries(db, requestTenantId, windowDays, gran);
          result.meta.dataSources = fed.dataSources;
          writeJson(res, 200, available(result));
        } catch {
          writeJson(res, 200, unavailable({ series: [] }, 'Failed cost timeseries'));
        }
        return;
      }

      if (url === '/api/dashboard/executive-summary' && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db;
          if (!db) {
            writeJson(res, 200, unavailable({ totalRequests: 0 }, 'No history database'));
            return;
          }
          const summary = await buildExecutiveSummary(db, requestTenantId, windowDays);
          summary.meta.dataSources = fed.dataSources;
          writeJson(res, 200, available(summary));
        } catch {
          writeJson(res, 200, unavailable({ totalRequests: 0 }, 'Failed executive summary'));
        }
        return;
      }

      if (url === '/api/analytics/summary' && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const { buildAnalyticsSummary } = await import('./analytics-summary.js');
          const summary = await buildAnalyticsSummary(fed.db, requestTenantId, windowDays);
          if (fed.dataSources?.length) {
            summary.meta.dataSources = fed.dataSources;
          }
          writeJson(res, 200, summary.available ? available(summary) : unavailable(summary, summary.emptyReason || 'No data'));
        } catch {
          writeJson(res, 200, unavailable({ totalRequests: 0 }, 'Failed analytics summary'));
        }
        return;
      }

      if (url.startsWith('/api/dashboard/insights/export') && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const scopeRaw = u.searchParams.get('scope') || 'overview';
          const scope = (['overview', 'cost', 'security', 'audit', 'ai'].includes(scopeRaw)
            ? scopeRaw
            : 'overview') as InsightScope;
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db;
          if (!db) {
            writeJson(res, 404, { error: 'No history database' });
            return;
          }
          const { formatInsightsBriefingMarkdown } = await import('./dashboard-insights.js');
          const insights = await buildDashboardInsights(db, requestTenantId, scope, { windowDays });
          const markdown = formatInsightsBriefingMarkdown(insights);
          const filename = `mastyf-ai-briefing-${scope}-${windowDays}d.md`;
          res.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
          });
          res.end(markdown);
        } catch {
          writeJson(res, 500, { error: 'Failed to export briefing' });
        }
        return;
      }

      if (url.startsWith('/api/analysis/full/download') && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const useLlm = u.searchParams.get('useLlm') !== 'false';
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db ?? runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable({ analysis: null }, 'No history database connected'));
            return;
          }
          const { buildMastyfAiFullAnalysis } = await import('../ai/mastyf-ai-full-analysis.js');
          const analysis = await buildMastyfAiFullAnalysis(db, requestTenantId, {
            windowDays,
            useLlm,
            historyDbAttached: true,
          });
          if (!analysis) {
            writeJson(res, 200, unavailable({ analysis: null }, 'Could not build full analysis'));
            return;
          }
          const date = new Date().toISOString().slice(0, 10);
          const filename = `mastyf-ai-full-analysis-${date}.md`;
          res.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
          });
          res.end(analysis.markdown);
        } catch (err: unknown) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Failed to download analysis',
          });
        }
        return;
      }

      if (url.startsWith('/api/analysis/full') && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const useLlm = u.searchParams.get('useLlm') !== 'false';
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db ?? runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable(
              { analysis: null },
              'No history database — start the Mastyf AI proxy with DASHBOARD_ENABLED=true and send MCP traffic through it.',
            ));
            return;
          }
          const { buildMastyfAiFullAnalysis } = await import('../ai/mastyf-ai-full-analysis.js');
          const analysis = await buildMastyfAiFullAnalysis(db, requestTenantId, {
            windowDays,
            useLlm,
            historyDbAttached: true,
          });
          if (!analysis) {
            writeJson(res, 200, unavailable({ analysis: null }, 'Could not build full analysis'));
            return;
          }
          writeJson(res, 200, available(analysis));
        } catch (err: unknown) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Failed to build full analysis',
          });
        }
        return;
      }

      if (url.startsWith('/api/reports/mcp-health/download') && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const useLlm = u.searchParams.get('useLlm') === 'true';
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db ?? runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable({ report: null }, 'No history database — start proxy with DASHBOARD_ENABLED=true'));
            return;
          }
          const { buildMcpHealthReport } = await import('../ai/mcp-health-report.js');
          const report = await buildMcpHealthReport(db, requestTenantId, { windowDays, useLlm });
          if (!report) {
            writeJson(res, 200, unavailable({ report: null }, 'Could not build health report'));
            return;
          }
          const date = report.generatedAt.slice(0, 10);
          const filename = `mastyf-ai-mcp-health-${date}.md`;
          res.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
          });
          res.end(report.markdown);
        } catch (err: unknown) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Failed to export MCP health report',
          });
        }
        return;
      }

      if (url.startsWith('/api/reports/mcp-health') && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const useLlm = u.searchParams.get('useLlm') === 'true';
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db ?? runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable(
              { report: null },
              'No history database — start the Mastyf AI proxy with DASHBOARD_ENABLED=true and send MCP traffic through it.',
            ));
            return;
          }
          const { buildMcpHealthReport } = await import('../ai/mcp-health-report.js');
          const report = await buildMcpHealthReport(db, requestTenantId, { windowDays, useLlm });
          if (!report) {
            writeJson(res, 200, unavailable({ report: null }, 'Could not build health report'));
            return;
          }
          writeJson(res, 200, available(report));
        } catch (err: unknown) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Failed to build MCP health report',
          });
        }
        return;
      }

      if (url.startsWith('/api/dashboard/insights') && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const scopeRaw = u.searchParams.get('scope') || 'overview';
          const scope = (['overview', 'cost', 'security', 'audit', 'ai'].includes(scopeRaw)
            ? scopeRaw
            : 'overview') as InsightScope;
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const db = fed.db;
          if (!db) {
            writeJson(res, 200, unavailable({
              scope,
              generatedAt: new Date().toISOString(),
              source: 'measured',
              bullets: [],
            }, 'No history database'));
            return;
          }
          const insights = await buildDashboardInsights(db, requestTenantId, scope, { windowDays });
          writeJson(res, 200, available(insights));
        } catch {
          writeJson(res, 200, unavailable({ bullets: [] }, 'Failed dashboard insights'));
        }
        return;
      }

      if (url === '/api/dashboard/regions' && method === 'GET') {
        setCors();
        try {
          const regions = await listFederatedRegions();
          writeJson(res, 200, available({ regions }));
        } catch {
          writeJson(res, 200, unavailable({ regions: [] }, 'Failed to list regions'));
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
          const { getSemanticRequestGateStatus } = await import('../ai/sync-semantic-request.js');
          const semanticGate = getSemanticRequestGateStatus(requestTenantId);
          writeJson(res, 200, available({
            serverReports: reps,
            atRisk,
            avgLatency,
            totalTools,
            semanticRequestGate: semanticGate.semanticRequestGate,
            semantic_layer_active: semanticGate.semantic_layer_active,
            semanticGateLlmConfigured: semanticGate.llmConfigured,
            enterpriseMode: semanticGate.enterpriseMode,
          }));
        } catch {
          writeJson(res, 200, unavailable({ serverReports: [], atRisk: [], avgLatency: null, totalTools: 0 }, 'Failed to read health data'));
        }
        return;
      }

      if (url === '/api/instances' && method === 'GET') {
        setCors();
        try {
          const fleet = await buildDashboardFleetResponse(runtimeHistoryDb, requestTenantId);
          writeJson(res, 200, available(fleet));
        } catch {
          writeJson(res, 200, unavailable({ instances: [], source: 'none', totalInstances: 0, activeInstances: 0 }, 'Failed to read fleet instances'));
        }
        return;
      }

      if (url === '/api/policy/suggestions/accept' && method === 'POST') {
        setCors();
        const b = await readBody(req);
        let rule = b.rule as import('../policy/policy-types.js').PolicyRule | undefined;
        if (!rule?.name || !rule?.action) {
          const { loadPendingSuggestions } = await import('../ai/suggestion-engine.js');
          const found = loadPendingSuggestions(requestTenantId).find(
            (s) => s.id === String(b.suggestionId || '')
              || (!!b.ruleName && s.ruleName === String(b.ruleName)),
          );
          if (found?.rule?.name && found.rule.action) {
            rule = found.rule;
          }
        }
        if (!rule?.name || !rule?.action) {
          writeJson(res, 400, { error: 'invalid_rule', reason: 'rule.name and rule.action are required' });
          return;
        }
        const { buildApprovalPreview } = await import('../ai/autopilot-approval.js');
        const { recordSuggestionOutcome } = await import('../ai/suggestion-engine.js');
        const policyPath = process.env['MASTYF_AI_POLICY_PATH'] || process.env['MASTYF_AI_POLICY_PATH'] || 'default-policy.yaml';
        const preview = buildApprovalPreview({
          suggestionId: String(b.suggestionId || ''),
          source: (b.source as 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern' | 'attack') || 'baseline',
          rule,
          actor: authResult.identity || String(b.userId || 'dashboard-user'),
          stage: (b.stage as 'shadow' | 'canary' | 'enforce') || 'canary',
          evidence: {
            confidence: typeof b.confidence === 'number' ? b.confidence : 0.5,
            replayCoverage: typeof b.replayCoverage === 'number' ? b.replayCoverage : 0.95,
            predictedFalsePositiveDelta: typeof b.predictedFalsePositiveDelta === 'number' ? b.predictedFalsePositiveDelta : 0,
            predictedBypassDelta: typeof b.predictedBypassDelta === 'number' ? b.predictedBypassDelta : 0,
            blastRadiusPercent: typeof b.blastRadiusPercent === 'number' ? b.blastRadiusPercent : 0.05,
            rollbackConfidence: typeof b.rollbackConfidence === 'number' ? b.rollbackConfidence : 0.95,
            canarySizePercent: typeof b.canarySizePercent === 'number' ? b.canarySizePercent : 0.05,
            simulationPassed: b.simulationPassed !== false,
          },
        });
        if (process.env.MASTYF_AI_AUTOPILOT_ENFORCE_SAFETY !== 'false' && !preview.safety.allowed) {
          writeJson(res, 422, {
            error: 'autopilot_safety_blocked',
            blockers: preview.safety.blockers,
            warnings: preview.safety.warnings,
            impact: preview.impact,
          });
          return;
        }
        await recordSuggestionOutcome(String(b.suggestionId || ''), 'applied', {
          ruleName: String(b.ruleName || b.suggestionId || 'unknown'),
          source: (b.source as 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern' | 'attack') || 'baseline',
          confidence: typeof b.confidence === 'number' ? b.confidence : 0.5,
          rule,
          policyPath,
          policyWatcher: policyWatcher ?? null,
          userId: authResult.identity || String(b.userId || ''),
          tenantId: requestTenantId,
        });
        const { appendLearningEvent } = await import('./learning-events.js');
        appendLearningEvent({
          type: 'autopilot_decision',
          detail: `accepted suggestion ${String(b.suggestionId || '')}`,
          confidence: typeof b.confidence === 'number' ? b.confidence : undefined,
          metadata: {
            stage: (b.stage as string) || 'canary',
            impact: preview.impact,
            safetyWarnings: preview.safety.warnings,
          },
        }, requestTenantId);
        writeJson(res, 200, { status: 'accepted', id: b.suggestionId, preview });
        return;
      }
      if (url === '/api/policy/suggestions/preview' && method === 'POST') {
        setCors();
        const b = await readBody(req);
        const rule = b.rule as import('../policy/policy-types.js').PolicyRule | undefined;
        if (!rule?.name || !rule?.action) {
          writeJson(res, 400, { error: 'invalid_rule', reason: 'rule.name and rule.action are required' });
          return;
        }
        const { buildApprovalPreview } = await import('../ai/autopilot-approval.js');
        const preview = buildApprovalPreview({
          suggestionId: String(b.suggestionId || ''),
          source: (b.source as 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern' | 'attack') || 'baseline',
          rule,
          actor: authResult.identity || String(b.userId || 'dashboard-user'),
          stage: (b.stage as 'shadow' | 'canary' | 'enforce') || 'canary',
          evidence: {
            confidence: typeof b.confidence === 'number' ? b.confidence : 0.5,
            replayCoverage: typeof b.replayCoverage === 'number' ? b.replayCoverage : 0.95,
            predictedFalsePositiveDelta: typeof b.predictedFalsePositiveDelta === 'number' ? b.predictedFalsePositiveDelta : 0,
            predictedBypassDelta: typeof b.predictedBypassDelta === 'number' ? b.predictedBypassDelta : 0,
            blastRadiusPercent: typeof b.blastRadiusPercent === 'number' ? b.blastRadiusPercent : 0.05,
            rollbackConfidence: typeof b.rollbackConfidence === 'number' ? b.rollbackConfidence : 0.95,
            canarySizePercent: typeof b.canarySizePercent === 'number' ? b.canarySizePercent : 0.05,
            simulationPassed: b.simulationPassed !== false,
          },
        });
        writeJson(res, 200, preview);
        return;
      }
      if (url === '/api/policy/suggestions/rollback' && method === 'POST') {
        setCors();
        const b = await readBody(req);
        const ruleName = String(b.ruleName || '').trim();
        if (!ruleName) {
          writeJson(res, 400, { error: 'ruleName is required' });
          return;
        }
        const policyPath = process.env['MASTYF_AI_POLICY_PATH'] || process.env['MASTYF_AI_POLICY_PATH'] || 'default-policy.yaml';
        const { removeSuggestionRuleFromPolicy } = await import('../ai/policy-applier.js');
        const { appendRollbackLedger } = await import('../ai/autopilot-approval.js');
        const removed = removeSuggestionRuleFromPolicy(ruleName, policyPath, policyWatcher ?? null);
        if (!removed.removed) {
          writeJson(res, 400, { error: 'rollback_failed', reason: removed.reason || 'rule not removed' });
          return;
        }
        appendRollbackLedger({
          suggestionId: String(b.suggestionId || `rollback:${ruleName}`),
          ruleName,
          actor: authResult.identity || String(b.userId || 'dashboard-user'),
          reason: String(b.reason || 'manual rollback'),
        });
        const { appendLearningEvent } = await import('./learning-events.js');
        appendLearningEvent({
          type: 'autopilot_rollback',
          detail: `rolled back rule ${ruleName}`,
          metadata: { reason: String(b.reason || 'manual rollback') },
        }, requestTenantId);
        writeJson(res, 200, { status: 'rolled_back', id: b.suggestionId || `rollback:${ruleName}`, ruleName });
        return;
      }
      if (url === '/api/policy/suggestions/rollback/ledger' && method === 'GET') {
        setCors();
        const { readRollbackLedger } = await import('../ai/autopilot-approval.js');
        writeJson(res, 200, { entries: readRollbackLedger(100) });
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
          tenantId: requestTenantId,
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
        const {
          loadSemanticAuditRecordsAsync,
          loadSemanticAuditRecordsWithTenantFallback,
          SEMANTIC_AUDIT_DASHBOARD_WINDOW_MS,
        } = await import('../ai/semantic-audit-store.js');
        const { isSemanticAsyncEnabledForTenant } = await import('../tenant/tenant-semantic-config.js');
        const sinceMs = SEMANTIC_AUDIT_DASHBOARD_WINDOW_MS;
        const scoped = await loadSemanticAuditRecordsAsync({
          limit: 200,
          tenantId: requestTenantId,
          sinceMs,
        });
        const records = scoped;
        let defaultTenantRecords = 0;
        if (scoped.length === 0 && requestTenantId !== DEFAULT_TENANT_ID) {
          const { records: fallback } = await loadSemanticAuditRecordsWithTenantFallback({
            limit: 200,
            tenantId: requestTenantId,
            sinceMs,
          });
          defaultTenantRecords = fallback.length;
        }
        const asyncEnabled = isSemanticAsyncEnabledForTenant(requestTenantId);
        writeJson(res, 200, {
          records,
          total: records.length,
          meta: {
            tenantId: requestTenantId,
            asyncEnabled,
            windowDays: 30,
            defaultTenantRecords,
            hint:
              records.length > 0
                ? undefined
                : defaultTenantRecords > 0
                  ? `No records for tenant "${requestTenantId}" — ${defaultTenantRecords} exist under "default". Switch tenant in the dashboard header.`
                  : asyncEnabled
                    ? 'No semantic audit records yet — learning warmup runs on proxy start, or route live MCP tool calls through the proxy.'
                    : 'Enable MASTYF_AI_SEMANTIC_ASYNC=true on the proxy (default when MASTYF_AI_LLM_ENABLED=true).',
          },
        });
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
          if (label === 'true_positive') {
            try {
              const { appendLearningEvent } = await import('./learning-events.js');
              appendLearningEvent(
                {
                  type: 'semantic_tp',
                  detail: `Labeled true positive ${body.semanticAuditId}`,
                  fingerprint: String(body.semanticAuditId),
                },
                requestTenantId,
              );
            } catch {
              /* non-fatal */
            }
            try {
              const { loadSemanticAuditRecordsAsync } = await import('../ai/semantic-audit-store.js');
              const records = await loadSemanticAuditRecordsAsync({ tenantId: requestTenantId, limit: 500 });
              const rec = records.find((r) => r.id === String(body.semanticAuditId));
              if (rec) {
                const { bridgeSemanticAuditToSuggestion } = await import('../ai/semantic-to-suggestion.js');
                void bridgeSemanticAuditToSuggestion(rec);
              }
            } catch {
              /* non-fatal */
            }
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
      if (url === '/api/security-swarm/job-log' && method === 'GET') {
        setCors();
        const { readSwarmTextArtifact, readSwarmJsonFile } = await import('./swarm-artifacts.js');
        const log = readSwarmTextArtifact('job.log', requestTenantId);
        const steps = readSwarmJsonFile<{ steps?: unknown[] }>('steps.json', requestTenantId);
        writeJson(res, 200, available({
          log: log || '',
          steps: steps?.steps ?? [],
          hasLog: !!log,
        }));
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
            'attachment; filename="mastyf-ai-swarm-analysis.txt"',
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
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const region = parseRegionParam(u.searchParams);
          const fed = await resolveChartContext(requestTenantId, windowDays, region);
          const { writeVisualsData } = await import('./export-visuals-data.js');
          const data = await writeVisualsData({
            tenantId: requestTenantId,
            historyDb: fed.db ?? runtimeHistoryDb ?? undefined,
            windowDays,
          }) as unknown as Record<string, unknown>;
          if (data.meta && typeof data.meta === 'object') {
            (data.meta as Record<string, unknown>).dataSources = fed.dataSources;
          }
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
      if (url === '/api/security-swarm/threat-lab-candidates' && method === 'GET') {
        setCors();
        const { readThreatLabCandidates } = await import('./swarm-artifacts.js');
        const data = readThreatLabCandidates(requestTenantId);
        if (!data) {
          writeJson(res, 404, { error: 'threat-lab-candidates.json not found' });
          return;
        }
        writeJson(res, 200, data);
        return;
      }
      if (url === '/api/security-swarm/threat-lab-candidates/accept' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const id = String(body.id || '').trim();
        if (!id) {
          writeJson(res, 400, { ok: false, error: 'id required' });
          return;
        }
        const { readThreatLabCandidates, markThreatLabCandidate } = await import('./swarm-artifacts.js');
        const data = readThreatLabCandidates(requestTenantId);
        const candidate = data?.candidates?.find((c: { id: string }) => c.id === id);
        if (!candidate) {
          writeJson(res, 404, { ok: false, error: 'Threat Lab candidate not found' });
          return;
        }
        const policyRule = candidate.policyRule as import('../policy/policy-types.js').PolicyRule | undefined;
        if (!policyRule?.name) {
          writeJson(res, 400, {
            ok: false,
            error: 'Candidate has no policyRule — re-run Threat Lab or pick a candidate with a generated rule',
          });
          return;
        }
        const { applySuggestionToPolicy } = await import('../ai/policy-applier.js');
        const policyPath = process.env['MASTYF_AI_POLICY_PATH'] || join(REPO_ROOT, 'default-policy.yaml');
        const result = await applySuggestionToPolicy(
          policyRule,
          policyPath,
          policyWatcher ?? null,
          { tenantId: requestTenantId },
        );
        if (!result.applied && result.reason !== 'duplicate') {
          writeJson(res, 400, {
            ok: false,
            error: result.reason ?? 'apply_failed',
            simulationSummary: result.simulationSummary,
          });
          return;
        }
        markThreatLabCandidate(requestTenantId, id, 'accepted');
        writeJson(res, 200, {
          ok: true,
          status: result.reason === 'duplicate' ? 'already_present' : 'accepted',
          id,
          ruleName: policyRule.name,
        });
        return;
      }
      if (url === '/api/security-swarm/threat-lab-candidates/reject' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const id = String(body.id || '');
        const { markThreatLabCandidate } = await import('./swarm-artifacts.js');
        markThreatLabCandidate(requestTenantId, id, 'rejected');
        writeJson(res, 200, { status: 'rejected', id });
        return;
      }
      if (url === '/api/security-swarm/auto-corpus' && method === 'GET') {
        setCors();
        const { readAutoCorpusManifest } = await import('./swarm-artifacts.js');
        const data = readAutoCorpusManifest(requestTenantId);
        if (!data) {
          writeJson(res, 404, { error: 'auto-corpus-manifest.json not found' });
          return;
        }
        writeJson(res, 200, data);
        return;
      }
      if (url.startsWith('/api/threat-discovery/')) {
        if (!assertFeature(url, 'swarm', res, setCors)) return;
      }
      if (url === '/api/threat-discovery/status' && method === 'GET') {
        setCors();
        const { buildThreatDiscoveryStatus } = await import('./threat-discovery-status.js');
        writeJson(res, 200, await buildThreatDiscoveryStatus(requestTenantId));
        return;
      }
      if (url === '/api/threat-discovery/automation/summary' && method === 'GET') {
        setCors();
        const { buildThreatAutomationSummary } = await import('./threat-automation-summary.js');
        writeJson(res, 200, await buildThreatAutomationSummary(requestTenantId));
        return;
      }
      if (url === '/api/threat-discovery/threat-lab/run' && method === 'POST') {
        setCors();
        const body = await readBody(req).catch(() => ({}));
        const mode = (body as { mode?: string }).mode === 'proactive' ? 'proactive' : 'reactive';
        const { startThreatLabJob } = await import('./threat-discovery-runner.js');
        const result = startThreatLabJob(requestTenantId, { mode });
        if (!result.ok) {
          writeJson(res, result.status ?? 409, { error: result.error, jobId: result.jobId });
          return;
        }
        writeJson(res, 202, { jobId: result.jobId, startedAt: result.startedAt, kind: 'threat-lab' });
        return;
      }
      if (url === '/api/threat-discovery/auto-research/run' && method === 'POST') {
        setCors();
        const { startAutoThreatResearchJob } = await import('./threat-discovery-runner.js');
        const result = startAutoThreatResearchJob(requestTenantId);
        if (!result.ok) {
          writeJson(res, result.status ?? 409, { error: result.error, jobId: result.jobId });
          return;
        }
        writeJson(res, 202, { jobId: result.jobId, startedAt: result.startedAt, kind: 'auto-research' });
        return;
      }
      const candidateMatch = url.match(/^\/api\/threat-discovery\/candidates\/([^/]+)$/);
      if (candidateMatch && method === 'GET') {
        setCors();
        const id = decodeURIComponent(candidateMatch[1]);
        const { readThreatLabCandidateById } = await import('./swarm-artifacts.js');
        const candidate = readThreatLabCandidateById(requestTenantId, id);
        if (!candidate) {
          writeJson(res, 404, { error: 'Candidate not found' });
          return;
        }
        writeJson(res, 200, candidate);
        return;
      }
      // ── Threat Discovery Scheduler (in-process, persists to ~/.mastyf-ai) ──
      if (url === '/api/threat-discovery/scheduler/start' && method === 'POST') {
        setCors();
        try {
          const { startScheduler } = await import('./threat-discovery-scheduler.js');
          const state = startScheduler(requestTenantId);
          writeJson(res, 200, { status: 'ok', ...state });
        } catch (err) {
          writeJson(res, 500, {
            status: 'error',
            error: err instanceof Error ? err.message : 'Failed to start scheduler',
          });
        }
        return;
      }
      if (url === '/api/threat-discovery/scheduler/stop' && method === 'POST') {
        setCors();
        try {
          const { stopScheduler } = await import('./threat-discovery-scheduler.js');
          const state = stopScheduler();
          writeJson(res, 200, { status: 'ok', ...state });
        } catch (err) {
          writeJson(res, 500, {
            status: 'error',
            error: err instanceof Error ? err.message : 'Failed to stop scheduler',
          });
        }
        return;
      }
      if (url === '/api/threat-discovery/scheduler/status' && method === 'GET') {
        setCors();
        try {
          const { getSchedulerStatus } = await import('./threat-discovery-scheduler.js');
          writeJson(res, 200, getSchedulerStatus(requestTenantId));
        } catch (err) {
          writeJson(res, 500, {
            running: false,
            error: err instanceof Error ? err.message : 'Failed to read scheduler status',
          });
        }
        return;
      }
      if (url === '/api/threat-discovery/promote/stats' && method === 'GET') {
        setCors();
        try {
          const { getPromotionStats } = await import('../ai/auto-corpus-promoter.js');
          writeJson(res, 200, await getPromotionStats());
        } catch {
          writeJson(res, 200, { error: 'Auto-corpus promoter not available', enabled: process.env['MASTYF_AI_AUTO_CORPUS_PROMOTE'] !== 'true' });
        }
        return;
      }
      if (url === '/api/threat-discovery/promote/batch' && method === 'POST') {
        setCors();
        try {
          const { getPromotionStats } = await import('../ai/auto-corpus-promoter.js');
          writeJson(res, 200, await getPromotionStats());
        } catch {
          writeJson(res, 200, { error: 'Auto-corpus promoter not available', enabled: process.env['MASTYF_AI_AUTO_CORPUS_PROMOTE'] !== 'true' });
        }
        return;
      }
      if (url === '/api/onboarding/status' && method === 'GET') {
        setCors();
        const { getOnboardingStatus } = await import('./server-registry.js');
        writeJson(res, 200, await getOnboardingStatus());
        return;
      }

      if (url === '/api/internal/rug-pull' && method === 'DELETE') {
        setCors();
        const expected = process.env['MASTYF_AI_INTERNAL_ADMIN_TOKEN'];
        const provided =
          (typeof req.headers['x-mastyf-ai-internal-token'] === 'string'
            ? req.headers['x-mastyf-ai-internal-token']
            : req.headers['authorization']?.replace(/^Bearer\s+/i, '')) || '';
        if (expected && provided !== expected) {
          writeJson(res, 401, { error: 'Unauthorized' });
          return;
        }
        try {
          const b = await readBody(req);
          const { clearRugPullAlert } = await import('../proxy/rug-pull-cluster.js');
          const serverName = String(b.serverName || b.server || '');
          const tenantId = String(b.tenantId || requestTenantId || 'default');
          if (!serverName) {
            writeJson(res, 400, { error: 'serverName required' });
            return;
          }
          await clearRugPullAlert(serverName, tenantId);
          writeJson(res, 200, available({ cleared: true, serverName, tenantId }));
        } catch (e) {
          writeJson(res, 500, { error: e instanceof Error ? e.message : 'Clear failed' });
        }
        return;
      }

      if (url === '/api/setup/status' && method === 'GET') {
        setCors();
        try {
          const { buildSetupStatus } = await import('./setup-status.js');
          writeJson(res, 200, available(await buildSetupStatus()));
        } catch (e) {
          writeJson(res, 500, { error: e instanceof Error ? e.message : 'Setup status failed' });
        }
        return;
      }

      if (url === '/api/setup/db-health' && method === 'GET') {
        setCors();
        const { probeDatabaseHealth } = await import('./setup-status.js');
        writeJson(res, 200, await probeDatabaseHealth());
        return;
      }

      if (url === '/api/setup/cloud-status' && method === 'GET') {
        setCors();
        const { readCloudSetup } = await import('./setup-status.js');
        writeJson(res, 200, readCloudSetup());
        return;
      }

      if (url === '/api/setup/mastyf-ai-config' && method === 'POST') {
        setCors();
        try {
          const body = await readBody(req);
          const upstreamUrl = String(body.upstreamUrl || '').trim();
          const listenPort = parseInt(String(body.listenPort || '8443'), 10);
          if (!upstreamUrl || !Number.isFinite(listenPort)) {
            writeJson(res, 400, { error: 'upstreamUrl and listenPort required' });
            return;
          }
          const { writeSetupFile } = await import('./setup-status.js');
          const patch: Record<string, unknown> = { upstreamUrl, listenPort };
          const token = String(body.authToken || '').trim();
          if (token) patch.authToken = token;
          writeSetupFile(patch as import('./setup-status.js').MastyfAiSetupConfig);
          writeJson(res, 200, { ok: true });
        } catch (e) {
          writeJson(res, 500, { error: e instanceof Error ? e.message : 'Save failed' });
        }
        return;
      }

      if (url === '/api/setup/cloud/connect' && method === 'POST') {
        setCors();
        try {
          const body = await readBody(req);
          const { connectCloudSetup } = await import('./setup-status.js');
          const result = connectCloudSetup({
            controlPlaneUrl: String(body.controlPlaneUrl || ''),
            ssoEnabled: body.ssoEnabled === true,
            policyStrictnessPct: Number(body.policyStrictnessPct) || 85,
            apiKeyRotationEnabled: body.apiKeyRotationEnabled === true,
          });
          writeJson(res, 200, result);
        } catch (e) {
          writeJson(res, 500, { ok: false, error: e instanceof Error ? e.message : 'Cloud connect failed' });
        }
        return;
      }

      if (url === '/api/autopilot/status' && method === 'GET') {
        setCors();
        try {
          const { buildAutopilotStatus } = await import('./autopilot-status.js');
          const status = await buildAutopilotStatus(requestTenantId, !!runtimeHistoryDb);
          writeJson(res, 200, available(status));
        } catch (err: unknown) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Autopilot status failed',
          });
        }
        return;
      }

      if (url === '/api/reports/digests/latest' && method === 'GET') {
        setCors();
        try {
          const { readLatestDigestArtifacts } = await import('./report-scheduler.js');
          const digest = readLatestDigestArtifacts(requestTenantId);
          writeJson(res, 200, available(digest));
        } catch (err: unknown) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Failed to read digest',
          });
        }
        return;
      }

      if (url === '/api/reports/generate' && method === 'POST') {
        setCors();
        try {
          const fed = await resolveChartContext(requestTenantId, 7, undefined);
          const db = fed.db ?? runtimeHistoryDb;
          if (!db) {
            writeJson(res, 200, unavailable({ paths: null }, 'No history database'));
            return;
          }
          const { generateDigest } = await import('./report-scheduler.js');
          const paths = await generateDigest(db, requestTenantId, 7);
          writeJson(res, 200, available(paths));
        } catch (err: unknown) {
          writeJson(res, 500, {
            error: err instanceof Error ? err.message : 'Digest generation failed',
          });
        }
        return;
      }

      if (url === '/api/ai/suggestions/pending' && method === 'GET') {
        setCors();
        try {
          const { buildAutopilotStatus } = await import('./autopilot-status.js');
          const st = await buildAutopilotStatus(requestTenantId, !!runtimeHistoryDb);
          const { getAiEngine } = await import('../ai/suggestion-engine.js');
          const engine = getAiEngine();
          let suggestions: unknown[] = [];
          if (engine) {
            const report = await engine.generateReport();
            suggestions = (report as { suggestions?: unknown[] })?.suggestions || [];
          }
          writeJson(res, 200, available({
            count: st.learning.pendingSuggestions,
            suggestions,
          }));
        } catch {
          writeJson(res, 200, unavailable({ count: 0, suggestions: [] }, 'Suggestions unavailable'));
        }
        return;
      }
      if (url === '/api/industry-standard/status' && method === 'GET') {
        setCors();
        try {
          if (!runtimeHistoryDb) {
            writeJson(res, 200, unavailable({ migration012: false }, 'History database unavailable'));
            return;
          }
          const { IndustryStandardStore } = await import('../database/industry-standard-store.js');
          const store = new IndustryStandardStore(runtimeHistoryDb);
          const counts = store.getStatus(requestTenantId);
          writeJson(res, 200, available({
            tenantId: requestTenantId,
            migration012: true,
            ...counts,
            generatedAt: new Date().toISOString(),
          }));
        } catch (err: unknown) {
          writeJson(res, 500, { error: err instanceof Error ? err.message : 'status_failed' });
        }
        return;
      }

      if (url === '/api/policy/simulate' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const { simulatePolicyCounterfactual } = await import('../ai/policy-counterfactual.js');
        const draftRule =
          body.rule && typeof body.rule === 'object' && 'name' in body.rule && 'action' in body.rule
            ? (body.rule as import('../policy/policy-types.js').PolicyRule)
            : undefined;
        const report = await simulatePolicyCounterfactual({
          draftRule,
          policyPath: body.policyPath ? String(body.policyPath) : undefined,
          tenantId: requestTenantId,
          windowDays: Number(body.windowDays) || 14,
          limit: body.limit != null ? Number(body.limit) : undefined,
        });
        writeJson(res, 200, available(report as unknown as Record<string, unknown>));
        return;
      }

      if (url === '/api/certification/registry' && method === 'GET') {
        setCors();
        try {
          if (!runtimeHistoryDb) {
            writeJson(res, 200, unavailable({ certifications: [] }, 'History database unavailable'));
            return;
          }
          const { IndustryStandardStore } = await import('../database/industry-standard-store.js');
          const store = new IndustryStandardStore(runtimeHistoryDb);
          const limit = Number(new URL(req.url || url, 'http://localhost').searchParams.get('limit')) || 100;
          const rows = store.listCertifications(requestTenantId, limit);
          const certifications = rows.map((r) => ({
            ...r,
            checks: (() => {
              try {
                return JSON.parse(r.checksJson) as unknown[];
              } catch {
                return [];
              }
            })(),
          }));
          writeJson(res, 200, available({ tenantId: requestTenantId, certifications, count: certifications.length }));
        } catch (err: unknown) {
          writeJson(res, 500, { error: err instanceof Error ? err.message : 'registry_failed' });
        }
        return;
      }

      if (url === '/api/benchmark/submit-local' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const profile = String(body.profile || '').trim();
        const blockRate = Number(body.blockRate);
        const falsePositiveRate = Number(body.falsePositiveRate);
        if (!profile || !Number.isFinite(blockRate) || !Number.isFinite(falsePositiveRate)) {
          writeJson(res, 400, { error: 'profile, blockRate, falsePositiveRate required' });
          return;
        }
        try {
          if (!runtimeHistoryDb) {
            writeJson(res, 503, unavailable({ ok: false }, 'History database unavailable'));
            return;
          }
          const { IndustryStandardStore } = await import('../database/industry-standard-store.js');
          const { randomUUID } = await import('crypto');
          const store = new IndustryStandardStore(runtimeHistoryDb);
          const id = randomUUID();
          store.saveBenchmarkSubmission({
            id,
            profile,
            packageName: body.packageName ? String(body.packageName) : undefined,
            blockRate,
            falsePositiveRate,
            p95LatencyMs: body.p95LatencyMs != null ? Number(body.p95LatencyMs) : undefined,
            scorecardJson: JSON.stringify(
              body.scorecard && typeof body.scorecard === 'object' ? body.scorecard : {},
            ),
            submittedAt: new Date().toISOString(),
            tenantId: requestTenantId,
          });
          writeJson(res, 201, available({ ok: true, id, tenantId: requestTenantId }));
        } catch (err: unknown) {
          writeJson(res, 500, { error: err instanceof Error ? err.message : 'submit_failed' });
        }
        return;
      }

      if (url === '/api/industry-standard/chain-graph' && method === 'GET') {
        setCors();
        try {
          if (!runtimeHistoryDb) {
            writeJson(res, 200, unavailable({ edges: [] }, 'History database unavailable'));
            return;
          }
          const { IndustryStandardStore } = await import('../database/industry-standard-store.js');
          const store = new IndustryStandardStore(runtimeHistoryDb);
          const events = store.listChainEvents(requestTenantId, 300);
          writeJson(res, 200, available({ tenantId: requestTenantId, events, count: events.length }));
        } catch (err: unknown) {
          writeJson(res, 500, { error: err instanceof Error ? err.message : 'chain_graph_failed' });
        }
        return;
      }

      if (url === '/api/industry-standard/capability-graph' && method === 'GET') {
        setCors();
        try {
          if (!runtimeHistoryDb) {
            writeJson(res, 200, unavailable({ edges: [] }, 'History database unavailable'));
            return;
          }
          const { IndustryStandardStore } = await import('../database/industry-standard-store.js');
          const store = new IndustryStandardStore(runtimeHistoryDb);
          const edges = store.listCapabilityEdges(requestTenantId, 500);
          writeJson(res, 200, available({ tenantId: requestTenantId, edges, count: edges.length }));
        } catch (err: unknown) {
          writeJson(res, 500, { error: err instanceof Error ? err.message : 'capability_graph_failed' });
        }
        return;
      }

      if (url === '/api/industry-standard/sandbox-tiers' && method === 'GET') {
        setCors();
        try {
          const container = await ensureAgenticContainer();
          if (!container) {
            writeJson(res, 200, unavailable({ tiers: [] }, 'Agentic container unavailable'));
            return;
          }
          const certs = container.certifier.listCertified();
          const tiers = certs.map((c: { serverName: string; level: string }) => ({
            serverName: c.serverName,
            tier: container.sandboxEnforcer.getTier({ scopeType: 'server', scopeId: c.serverName }),
            certLevel: c.level,
          }));
          writeJson(res, 200, available({ tenantId: requestTenantId, tiers }));
        } catch (err: unknown) {
          writeJson(res, 500, { error: err instanceof Error ? err.message : 'sandbox_tiers_failed' });
        }
        return;
      }

      if (url === '/api/agentic/playbook/approve' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const approvalId = String(body.approvalId ?? '');
        const approve = body.approve !== false;
        const container = await ensureAgenticContainer();
        if (!container?.approvalGate || !approvalId) {
          writeJson(res, 400, { error: 'approvalId required' });
          return;
        }
        if (approve) {
          container.approvalGate.approve(approvalId);
        } else {
          container.approvalGate.deny(approvalId);
        }
        writeJson(res, 200, available({ ok: true, approvalId, approve }));
        return;
      }

      if (url === '/api/certification/mastyf-ai-mcp' && method === 'GET') {
        setCors();
        const { evaluateMastyfAiCertification } = await import('./mastyf-ai-certified-mcp.js');
        const data = evaluateMastyfAiCertification(REPO_ROOT);
        writeJson(res, 200, available(data as unknown as Record<string, unknown>));
        return;
      }
      if (url === '/api/benchmarks/similar-environment' && method === 'GET') {
        setCors();
        try {
          const serverNames = runtimeHistoryDb
            ? await getAllActiveServerNames(runtimeHistoryDb, requestTenantId)
            : [];
          const records = runtimeHistoryDb
            ? await loadAllCallRecords(runtimeHistoryDb, serverNames, requestTenantId)
            : [];
          const { buildSimilarEnvironmentBenchmarks } = await import('../ai/similar-environment-benchmarks.js');
          const benchmarks = buildSimilarEnvironmentBenchmarks(records);
          writeJson(res, 200, available({ tenantId: requestTenantId, benchmarks }));
        } catch (err: unknown) {
          writeJson(res, 500, { error: err instanceof Error ? err.message : 'benchmark_failed' });
        }
        return;
      }
      if (url === '/api/assurance/continuous' && method === 'GET') {
        setCors();
        try {
          const serverNames = runtimeHistoryDb
            ? await getAllActiveServerNames(runtimeHistoryDb, requestTenantId)
            : [];
          const records = runtimeHistoryDb
            ? await loadAllCallRecords(runtimeHistoryDb, serverNames, requestTenantId)
            : [];
          const { buildAutopilotStatus } = await import('./autopilot-status.js');
          const autopilot = await buildAutopilotStatus(requestTenantId, !!runtimeHistoryDb);
          const { buildSimilarEnvironmentBenchmarks } = await import('../ai/similar-environment-benchmarks.js');
          const { buildContinuousAssuranceReport } = await import('../ai/continuous-assurance.js');
          const benchmarks = buildSimilarEnvironmentBenchmarks(records);
          const report = buildContinuousAssuranceReport({
            tenantId: requestTenantId,
            records,
            autopilot,
            benchmarks,
          });
          writeJson(res, 200, available(report as unknown as Record<string, unknown>));
        } catch (err: unknown) {
          writeJson(res, 500, { error: err instanceof Error ? err.message : 'assurance_failed' });
        }
        return;
      }
      if (url === '/api/partners/signals' && method === 'GET') {
        setCors();
        const { buildPartnerSignalFeed } = await import('./mastyf-ai-certified-mcp.js');
        const data = buildPartnerSignalFeed(REPO_ROOT);
        writeJson(res, 200, available(data));
        return;
      }
      if (url === '/api/servers/registry' && method === 'GET') {
        setCors();
        const { discoverAllServers } = await import('../fleet/unified-server-registry.js');
        const { readFleetState } = await import('../fleet/fleet-state.js');
        const { getServerRegistry } = await import('./server-registry.js');
        const unified = discoverAllServers();
        const fleet = readFleetState();
        const fleetByName = new Map((fleet?.servers ?? []).map((s) => [s.name, s]));
        const servers = await getServerRegistry();
        const { listUiServers } = await import('./mcp-server-config.js');
        const uiServers = listUiServers();
        const enriched = unified.map((e) => {
          const live = fleetByName.get(e.name);
          const metrics = servers.find((s) => s.name === e.name)?.metrics;
          return {
            ...e,
            localUrl: live?.localUrl,
            status: live?.status ?? 'unknown',
            metrics,
          };
        });
        writeJson(res, 200, { servers, uiServers, unified: enriched, fleet });
        return;
      }
      if (url === '/api/fleet/status' && method === 'GET') {
        setCors();
        const { discoverAllServers } = await import('../fleet/unified-server-registry.js');
        const { readFleetState } = await import('../fleet/fleet-state.js');
        writeJson(res, 200, {
          entries: discoverAllServers(),
          fleet: readFleetState(),
        });
        return;
      }
      if (url === '/api/fleet/start' && method === 'POST') {
        setCors();
        const { fleetAdminRequest } = await import('../fleet/fleet-supervisor.js');
        try {
          const result = await fleetAdminRequest('/restart', 'POST');
          writeJson(res, 200, result);
        } catch {
          writeJson(res, 503, {
            ok: false,
            error: 'Fleet supervisor not running — run mastyf-ai start',
          });
        }
        return;
      }
      if (url === '/api/fleet/stop' && method === 'POST') {
        setCors();
        const { fleetAdminRequest } = await import('../fleet/fleet-supervisor.js');
        try {
          const result = await fleetAdminRequest('/stop', 'POST');
          writeJson(res, 200, result);
        } catch {
          writeJson(res, 503, { ok: false, error: 'Fleet supervisor not running' });
        }
        return;
      }
      if (url === '/api/fleet/restart' && method === 'POST') {
        setCors();
        const { fleetAdminRequest } = await import('../fleet/fleet-supervisor.js');
        try {
          const result = await fleetAdminRequest('/restart', 'POST');
          writeJson(res, 200, result);
        } catch {
          writeJson(res, 503, { ok: false, error: 'Fleet supervisor not running' });
        }
        return;
      }
      if (url === '/api/servers' && method === 'POST') {
        setCors();
        const body = await readBody(req);
        const { addUiServer } = await import('./mcp-server-config.js');
        const { fleetEntryFromMcpConfig, materializeServerConfig } = await import('../fleet/unified-server-registry.js');
        const { getActiveSupervisor } = await import('../fleet/fleet-supervisor.js');
        const result = addUiServer({
          name: String(body.name || ''),
          command: String(body.command || ''),
          args: Array.isArray(body.args) ? body.args.map(String) : [],
          env: body.env as Record<string, string> | undefined,
          transport: (body.transport as 'stdio' | 'sse') || 'stdio',
          url: body.url ? String(body.url) : undefined,
          disabled: body.disabled === true,
        });
        if (!result.ok) {
          writeJson(res, 400, result);
          return;
        }
        const { loadUiMcpServers } = await import('./mcp-server-config.js');
        const added = loadUiMcpServers().find((s) => s.name === String(body.name || ''));
        let localUrl: string | undefined;
        let reloadRequired = false;
        if (added) {
          const entry = fleetEntryFromMcpConfig(added, 'ui');
          materializeServerConfig(entry);
          const supervisor = getActiveSupervisor();
          if (supervisor) {
            const spawnResult = await supervisor.addServer(entry);
            localUrl = spawnResult.localUrl;
            reloadRequired = spawnResult.reloadRequired;
          }
        }
        writeJson(res, 200, { ...result, localUrl, reloadRequired });
        return;
      }
      if (url?.startsWith('/api/servers/') && method === 'DELETE') {
        setCors();
        const name = decodeURIComponent(url.slice('/api/servers/'.length));
        const { removeUiServer } = await import('./mcp-server-config.js');
        const result = removeUiServer(name);
        writeJson(res, result.ok ? 200 : 404, result);
        return;
      }
      if (url?.startsWith('/api/servers/') && method === 'PATCH') {
        setCors();
        const name = decodeURIComponent(url.slice('/api/servers/'.length));
        const body = await readBody(req);
        const { updateUiServer } = await import('./mcp-server-config.js');
        const patch: Partial<UiMcpServerConfig> = {};
        if (body.command !== undefined) patch.command = String(body.command);
        if (body.args !== undefined) patch.args = Array.isArray(body.args) ? body.args.map(String) : [];
        if (body.env !== undefined) patch.env = body.env as Record<string, string>;
        if (body.transport !== undefined) patch.transport = body.transport as 'stdio' | 'sse';
        if (body.url !== undefined) patch.url = body.url ? String(body.url) : undefined;
        if (body.disabled !== undefined) patch.disabled = body.disabled === true;
        const result = updateUiServer(name, patch);
        writeJson(res, result.ok ? 200 : 404, result);
        return;
      }

      // ── Agentic AI API handlers ─────────────────────────────────
      // ── Agentic AI: Action endpoints (POST) ──────────────────────
      if (url === '/api/agentic/policy-gen/start-observation' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        const window = c.behaviorCollector.startWindow();
        writeJson(res, 200, { ok: true, windowId: window.windowId, message: `Observation started. Tools being recorded. Use 'generate policy' once enough calls observed.` });
        return;
      }

      if (url === '/api/agentic/policy-gen/stop-observation' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        const window = c.behaviorCollector.finalizeWindow();
        if (!window) { writeJson(res, 400, { ok: false, error: 'No active observation to stop' }); return; }
        writeJson(res, 200, { ok: true, totalCalls: window.totalCalls, uniqueTools: window.uniqueTools });
        return;
      }

      if (url === '/api/agentic/policy-gen/generate' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        const windows = c.behaviorCollector.getHistory();
        if (windows.length === 0) { writeJson(res, 400, { ok: false, error: 'No observation data. Start an observation first.' }); return; }
        const latest = windows[windows.length - 1]!;
        const analysis = c.patternAnalyzer.analyze(latest, latest.stats);
        const policy = c.policySynthesizer.synthesize(analysis);
        writeJson(res, 200, { ok: true, policy: policy.yaml, summary: policy.summary, confidence: policy.confidence, suggestions: policy.suggestions });
        return;
      }

      if (url === '/api/agentic/prompt-injection/scan' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const body = await readBody(req);
        const toolName = String(body.toolName || 'test');
        const args = (body.arguments || body.args || {}) as Record<string, unknown>;
        const serverName = String(body.serverName || 'dashboard');
        if (!c) {
          // Fallback: run detector standalone
          const modelProvider = new (await import('../agentic/model-provider.js')).AgenticModelProvider();
          const detector = new (await import('../agentic/prompt-injection/detector.js')).PromptInjectionDetector(modelProvider);
          const result = await detector.scan(toolName, serverName, args);
          writeJson(res, 200, { detected: result.data?.detected, category: result.data?.category, confidence: result.data?.confidence, explanation: result.data?.explanation, suspiciousArgs: result.data?.suspiciousArgs });
        } else {
          const result = await c.promptInjectionDetector.scan(toolName, serverName, args);
          writeJson(res, 200, { detected: result.data?.detected, category: result.data?.category, confidence: result.data?.confidence, explanation: result.data?.explanation, suspiciousArgs: result.data?.suspiciousArgs });
        }
        return;
      }

      if (url === '/api/agentic/honeypot/deploy' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        const body = await readBody(req);
        const instance = c.honeypotManager.deploy({
          name: String(body.name || `dashboard-${Date.now()}`),
          template: (body.template || 'fake-production-database') as any,
          ttlMs: (Number(body.ttlMinutes) || 30) * 60 * 1000,
          alertOnInteraction: body.alertOnInteraction !== false,
        });
        writeJson(res, 200, { ok: true, id: instance.id, name: instance.config.name, template: instance.config.template, expiresAt: instance.expiresAt });
        return;
      }

      if (url === '/api/agentic/red-team/run' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        const body = await readBody(req);
        const count = Number(body.attackCount) || 50;
        const attacks = c.attackGenerator.generateAllAttacks().slice(0, count);
        const categories = [...new Set(attacks.map((a: any) => a.category))];
        writeJson(res, 200, { ok: true, attackCount: attacks.length, categories, samplePayloads: attacks.slice(0, 5).map((a: any) => ({ id: a.id, category: a.category, snippet: a.payload.slice(0, 80) })) });
        return;
      }

      if (url === '/api/agentic/trust/register' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        const body = await readBody(req);
        c.trustProtocol.registerAgent({
          agentId: String(body.agentId || 'unknown'),
          mastyfAiInstance: String(body.mastyfAiInstance || 'dashboard'),
          capabilities: Array.isArray(body.capabilities) ? body.capabilities : ['read'],
        });
        writeJson(res, 200, { ok: true, agentId: body.agentId });
        return;
      }

      if (url === '/api/agentic/supply-chain/verify' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const body = await readBody(req);
        const pkg = String(body.packageName || '');
        const ver = String(body.version || 'latest');
        if (!pkg) { writeJson(res, 400, { error: 'packageName required' }); return; }
        if (c) {
          const result = c.signatureVerifier.verify(pkg, ver);
          writeJson(res, 200, { verified: result.verified, integrityScore: result.integrityScore, trustedPublisher: result.trustedPublisher, issues: result.issues });
        } else {
          const verifier = new (await import('../agentic/supply-chain/signature-verifier.js')).SignatureVerifier();
          const result = verifier.verify(pkg, ver);
          writeJson(res, 200, { verified: result.verified, integrityScore: result.integrityScore, trustedPublisher: result.trustedPublisher, issues: result.issues });
        }
        return;
      }

      if (url === '/api/agentic/drift/capture-baseline' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        const body = await readBody(req);
        const sn = String(body.serverName || 'filesystem');
        const baseline = c.driftDetector.captureBaseline(sn, [], { latencyP50: 100, latencyP95: 500, successRate: 1.0, avgResponseSize: 1024 });
        writeJson(res, 200, { ok: true, id: baseline.id, serverName: sn, capturedAt: baseline.capturedAt });
        return;
      }

      if (url === '/api/agentic/status' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        if (c) {
          const metrics = c.telemetry.getMetrics(c.taskQueue.getStats());
          writeJson(res, 200, {
            uptimeMs: metrics.uptimeMs,
            totalDecisions: metrics.totalDecisions,
            avgConfidence: metrics.avgConfidence,
            llmTokensUsed: metrics.llmTokensUsed,
            llmCostEstimate: metrics.llmCostEstimate,
            llmAvailable: c.modelProvider.isAvailable(),
            features: [
              { name: 'Policy Generation', status: c.behaviorCollector.isActive() ? 'observing' : 'idle' },
              { name: 'Prompt Injection Detection', status: 'active' },
              { name: 'Threat Prediction', status: 'active' },
              { name: 'Supply Chain Verification', status: 'active' },
              { name: 'Drift Detection', status: 'active' },
              { name: 'Compliance Mapping', status: 'active' },
              { name: 'Red Team Engine', status: 'active' },
              { name: 'Threat Intel Mesh', status: c.threatMeshNode.isEnabled() ? 'active' : 'disabled' },
              { name: 'Honeypot Manager', status: `${c.honeypotManager.getSummary().active} active` },
              { name: 'Trust Negotiation', status: 'active' },
            ],
          });
        } else {
          writeJson(res, 200, {
            uptimeMs: 0, totalDecisions: 0, avgConfidence: 0, llmTokensUsed: 0, llmCostEstimate: 0,
            llmAvailable: false,
            features: [
              { name: 'Policy Generation', status: 'idle' },
              { name: 'Prompt Injection Detection', status: 'active' },
              { name: 'Threat Prediction', status: 'active' },
              { name: 'Supply Chain Verification', status: 'active' },
              { name: 'Drift Detection', status: 'active' },
              { name: 'Compliance Mapping', status: 'active' },
              { name: 'Red Team Engine', status: 'active' },
              { name: 'Threat Intel Mesh', status: 'disabled' },
              { name: 'Honeypot Manager', status: '0 active' },
              { name: 'Trust Negotiation', status: 'active' },
            ],
          });
        }
        return;
      }

      if (url === '/api/agentic/tasks' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        writeJson(res, 200, c ? c.taskQueue.getStats() : { queued: 0, running: 0, completed: 0, failed: 0 });
        return;
      }

      if (url.startsWith('/api/agentic/tasks/') && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const match = url.match(/\/api\/agentic\/tasks\/([^/]+)\/(approve|deny)$/);
        if (!match) { writeJson(res, 400, { error: 'Invalid task action' }); return; }
        if (!c) { writeJson(res, 200, { success: false, error: 'Agentic services not initialized' }); return; }
        const ok = match[2] === 'approve' ? c.approvalGate.approve(match[1]) : c.approvalGate.deny(match[1]);
        writeJson(res, 200, { success: ok, id: match[1], action: match[2] });
        return;
      }

      if (url === '/api/agentic/policy-gen/status' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        if (c) {
          const summary = c.behaviorCollector.getSummary();
          writeJson(res, 200, { active: c.behaviorCollector.isActive(), currentObservation: summary, historicalWindows: c.behaviorCollector.getHistory().length });
        } else {
          writeJson(res, 200, { active: false, currentObservation: null, historicalWindows: 0 });
        }
        return;
      }

      if (url === '/api/agentic/policy-gen/generated' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        if (c) {
          const windows = c.behaviorCollector.getHistory();
          if (windows.length > 0) {
            const latest = windows[windows.length - 1]!;
            const analysis = c.patternAnalyzer.analyze(latest, latest.stats);
            const policy = c.policySynthesizer.synthesize(analysis);
            writeJson(res, 200, { policy, toolProfiles: analysis.toolProfiles, workflows: analysis.normalWorkflows });
          } else {
            writeJson(res, 200, { policies: [], note: 'Use start_behavior_observation MCP tool first' });
          }
        } else {
          writeJson(res, 200, { policies: [], note: 'Agentic services not initialized' });
        }
        return;
      }

      if (url === '/api/agentic/prompt-injection/stats' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        writeJson(res, 200, c ? c.promptInjectionDetector.getStats() : { totalScans: 0, totalDetections: 0, detectionRate: 0 });
        return;
      }

      if (url.startsWith('/api/agentic/threat-prediction/') && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        const serverName = decodeURIComponent(url.replace('/api/agentic/threat-prediction/', ''));
        if (!c || !serverName) {
          writeJson(res, 200, { available: false, serverName, error: 'Agentic services not initialized' });
          return;
        }
        const risk = c.riskScorer.scoreServer(
          { name: serverName, transport: 'stdio' } as import('../types.js').McpServerConfig,
          0,
          0,
        );
        const forecast = c.threatPredictor.forecast(risk, 0, 'stable');
        writeJson(res, 200, { available: true, forecast });
        return;
      }

      if (url === '/api/agentic/dashboard' && method === 'GET') {
        setCors();
        try {
          const u = new URL(req.url || url, 'http://localhost');
          const windowDays = parseWindowDays(u.searchParams.get('window') || '7');
          const fed = await resolveChartContext(requestTenantId, windowDays);
          const { ensureAgenticContainer } = await import('./agentic-container.js');
          const { buildAgenticDashboardSummary } = await import('./agentic-dashboard-summary.js');
          const container = (await ensureAgenticContainer()) ?? getAgenticContainer();
          const summary = await buildAgenticDashboardSummary(
            fed.db ?? runtimeHistoryDb ?? null,
            container,
            requestTenantId,
            windowDays,
          );
          if (fed.dataSources?.length) {
            summary.meta.dataSources = [...new Set([...summary.meta.dataSources, ...fed.dataSources])];
          }
          writeJson(res, 200, available(summary));
        } catch (err: unknown) {
          writeJson(res, 500, {
            available: false,
            error: err instanceof Error ? err.message : 'Failed to build agentic dashboard',
          });
        }
        return;
      }

      if (url === '/api/agentic/audit' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        const u = new URL(req.url || url, 'http://localhost');
        const limit = Math.min(200, Math.max(1, parseInt(u.searchParams.get('limit') || '50', 10)));
        if (!c) {
          writeJson(res, 200, available({ records: [], stats: { totalRecords: 0, totalBlocked: 0, totalAllowed: 0, averageLatencyMs: 0 } }));
          return;
        }
        writeJson(res, 200, available({
          records: c.requestAuditor.getRecords(limit),
          stats: c.requestAuditor.getStats(),
        }));
        return;
      }

      if (url === '/api/agentic/decisions' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        const u = new URL(req.url || url, 'http://localhost');
        const limit = Math.min(200, Math.max(1, parseInt(u.searchParams.get('limit') || '50', 10)));
        if (!c) {
          writeJson(res, 200, available({ decisions: [] }));
          return;
        }
        writeJson(res, 200, available({ decisions: c.telemetry.getRecentDecisions(limit) }));
        return;
      }

      if (url === '/api/agentic/tasks/detail' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        if (!c) {
          writeJson(res, 200, available({ stats: { queued: 0, running: 0, completed: 0, failed: 0, total: 0 }, pendingApprovals: [], tasks: [] }));
          return;
        }
        const stats = c.taskQueue.getStats();
        const pendingApprovals = c.approvalGate.listPending();
        const tasks = c.taskQueue.getStats();
        writeJson(res, 200, available({ stats, pendingApprovals, tasks }));
        return;
      }

      if (url === '/api/agentic/scheduler/status' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        writeJson(res, 200, available({ tasks: c ? c.agenticScheduler.getStatus() : [] }));
        return;
      }

      if (url === '/api/compliance/posture' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        if (c) {
          const frameworks = ['soc2', 'hipaa', 'pci-dss', 'fedramp', 'iso27001'] as const;
          const postures = frameworks.map(f => c.controlMapper.evaluate(f, [], []));
          const overall = Math.round(postures.reduce((s, p) => s + p.postureScore, 0) / postures.length);
          writeJson(res, 200, { frameworks: postures, overall });
        } else {
          const fws = ['soc2', 'hipaa', 'pci-dss', 'fedramp', 'iso27001'] as const;
          const names: Record<string, string> = {
            soc2: 'SOC 2 (Service Organization Control)', hipaa: 'HIPAA Security Rule', 'pci-dss': 'PCI-DSS v4.0', fedramp: 'FedRAMP (Moderate)', iso27001: 'ISO/IEC 27001:2022',
          };
          writeJson(res, 200, { frameworks: fws.map(f => ({ framework: f, frameworkName: names[f], postureScore: 0, satisfiedControls: 0, totalControls: 5 })), overall: 0 });
        }
        return;
      }

      if (url.startsWith('/api/compliance/evidence/') && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        const framework = url.split('/').pop() as string;
        if (c) {
          const posture = c.controlMapper.evaluate(framework as any, [], []);
          writeJson(res, 200, posture);
        } else {
          writeJson(res, 200, { framework, postureScore: 0, satisfiedControls: 0, totalControls: 5, criticalGaps: [], summary: 'Connect to active Mastyf AI server.' });
        }
        return;
      }

      if (url.startsWith('/api/agentic/drift/') && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        const serverName = url.replace('/api/agentic/drift/', '');
        if (c && serverName) {
          const baselines = c.driftDetector.getBaselines(serverName);
          writeJson(res, 200, { serverName, baselineCount: baselines.length, latestBaseline: baselines[baselines.length - 1] || null });
        } else {
          writeJson(res, 200, { baselineCount: 0, latestBaseline: null });
        }
        return;
      }

      if (url === '/api/agentic/red-team/results' && method === 'GET') {
        setCors();
        writeJson(res, 200, { status: 'ready', baseAttacks: 16, mutationStrategies: 6, combinationEngine: 'active' });
        return;
      }

      if (url === '/api/agentic/threat-mesh/status' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        if (c) {
          writeJson(res, 200, c.threatMeshNode.getStats());
        } else {
          writeJson(res, 200, { enabled: false, localSignatures: 0, pendingSignatures: 0 });
        }
        return;
      }

      if (url === '/api/agentic/honeypots' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        if (c) {
          writeJson(res, 200, { summary: c.honeypotManager.getSummary(), honeypots: c.honeypotManager.getAll() });
        } else {
          writeJson(res, 200, { summary: { active: 0, totalDeployments: 0, totalCaptures: 0, recentAlerts: 0 }, honeypots: [] });
        }
        return;
      }

      if (url === '/api/agentic/trust/sessions' && method === 'GET') {
        setCors();
        const c = getAgenticContainer();
        if (c) {
          writeJson(res, 200, { sessions: c.trustProtocol.getActiveSessions(), registry: c.trustProtocol.getTrustRegistry(), stats: c.trustProtocol.getStats() });
        } else {
          writeJson(res, 200, { sessions: [], registry: [], stats: { totalNegotiations: 0, failedNegotiations: 0, activeSessions: 0, registeredAgents: 0 } });
        }
        return;
      }

      if (url === '/api/agentic/supply-chain/status' && method === 'GET') {
        setCors();
        writeJson(res, 200, { status: 'active', modules: ['signature-verifier', 'typo-squat-detector', 'dependency-confusion-detector'] });
        return;
      }

      // ── Agentic AI: Additional POST handlers for frontend ────────
      if (url === '/api/agentic/trust-score/compute' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        const sn = String(b.serverName || 'unknown');
        if (!c) { writeJson(res, 200, { grade: 'B', overallScore: 60, categories: [], improvementActions: [] }); return; }
        const score = c.mastyfAiScore.compute({ serverName: sn, cveCount: 0, maxCvss: 0, newestCveAgeDays: 0, authMethod: 'none', transport: 'stdio', highRiskToolCount: 0, mediumRiskToolCount: 0, totalToolCount: 0, trustedPublisher: false, typoSquatDetected: false, depConfusionDetected: false, blockedCalls: 0, bypassedAttacks: 0, responseDlpActive: false, mastyfAiProtected: true });
        writeJson(res, 200, score);
        return;
      }

      if (url === '/api/agentic/dlp/scan' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        const respText = String(b.responseText || '');
        if (!c) { writeJson(res, 200, { violated: false, violations: [], block: false }); return; }
        const result = c.responseDlp.scan('dashboard', 'dashboard', respText);
        writeJson(res, 200, result);
        return;
      }

      if (url === '/api/agentic/certification/certify' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        const result = c.certifier.certify(String(b.serverName||'unknown'), String(b.packageName||''), String(b.version||'latest'), { trustScore: Number(b.trustScore)||50, complianceScore: Number(b.complianceScore)||0, cveFree: b.cveFree!==false, authMethod: String(b.authMethod||'none'), transport: String(b.transport||'stdio'), trustedPublisher: b.trustedPublisher===true });
        writeJson(res, 200, result);
        return;
      }

      if (url === '/api/agentic/fuzzer/run' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        const blockFn = (_m: string, _p: Record<string, unknown>) => ({ blocked: false });
        c.protocolFuzzer.runFuzzer(blockFn);
        writeJson(res, 200, c.protocolFuzzer.getStats());
        return;
      }

      if (url === '/api/agentic/sla/check' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        const sn = String(b.serverName || 'filesystem');
        const tn = String(b.toolName || 'read_file');
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        if (isAgenticDemoMode()) {
          c.slaEnforcer.record(sn, tn, 100, true);
          c.slaEnforcer.record(sn, tn, 200, true);
          c.slaEnforcer.record(sn, tn, 500, false);
        }
        writeJson(res, 200, { ...c.slaEnforcer.check(sn, tn), demo: isAgenticDemoMode() });
        return;
      }

      if (url === '/api/agentic/playbook/run' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        if (!c) { writeJson(res, 500, { error: 'Agentic services not initialized' }); return; }
        const report = c.incidentPlaybook.run(String(b.trigger||'test'), 'dashboard', (b.severity||'high') as any, String(b.playbook||'prompt_injection'));
        writeJson(res, 200, report);
        return;
      }

      if (url === '/api/agentic/reputation/get' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        const agentId = String(b.agentId || 'unknown');
        if (!c) { writeJson(res, 200, { agentId, score: 0.5, tier: 'standard' }); return; }
        if (isAgenticDemoMode()) {
          c.reputationEngine.record(agentId, 'test', false, 100);
        }
        writeJson(res, 200, { ...c.reputationEngine.getScore(agentId), demo: isAgenticDemoMode() });
        return;
      }

      if (url === '/api/agentic/harden/analyze' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        const sn = String(b.serverName || 'filesystem');
        if (!c) { writeJson(res, 200, { serverName: sn, score: 85, grade: 'B', recommendations: [] }); return; }
        writeJson(res, 200, c.configHardener.analyze({ name: sn, transport: 'stdio' } as any));
        return;
      }

      if (url === '/api/agentic/collusion/detect' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        if (!c) { writeJson(res, 200, { alerts: [] }); return; }
        if (isAgenticDemoMode()) {
          c.collusionDetector.record('agent-a', 'filesystem', 'list_directory');
          c.collusionDetector.record('agent-b', 'filesystem', 'read_file');
        }
        writeJson(res, 200, { alerts: c.collusionDetector.getAlerts(), demo: isAgenticDemoMode() });
        return;
      }

      if (url === '/api/agentic/rl/thompson' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        const agentId = String(b.agentId || 'unknown');
        if (!c) { writeJson(res, 200, { agentId, sampledScore: 0.5, meanScore: 0.5, tier: 'standard' }); return; }
        if (isAgenticDemoMode()) {
          c.thompsonSampling.record(agentId, 'safe');
          c.thompsonSampling.record(agentId, 'safe');
          c.thompsonSampling.record(agentId, 'blocked');
        }
        writeJson(res, 200, { ...c.thompsonSampling.sample(agentId), demo: isAgenticDemoMode() });
        return;
      }

      if (url === '/api/agentic/rl/bandit' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        if (!c) { writeJson(res, 200, { action: 'skip', expectedReward: 0, exploration: true }); return; }
        const decision = c.contextualBandit.selectAction({ serverType: String(b.serverType||'filesystem'), hourOfDay: new Date().getHours(), agentTier: String(b.agentTier||'standard'), ruleCategory: String(b.ruleCategory||'shell_injection') });
        writeJson(res, 200, decision);
        return;
      }

      if (url === '/api/agentic/rl/sarsa' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        if (!c) { writeJson(res, 200, { action: 'maintain', newValue: 500, qValues: [] }); return; }
        const state = { blockRate: Number(b.blockRate)||0.3, fpRate: Number(b.fpRate)||0.05, callVolume: Number(b.callVolume)||0.5 };
        const decision = c.sarsaThresholds.decide(String(b.parameter||'rateLimit') as any, state);
        writeJson(res, 200, decision);
        return;
      }

      // ── Agentic AI: LLM Analysis ────────────────────────────────
      if (url === '/api/agentic/llm-analyze' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        const b = await readBody(req).catch(() => ({})) as Record<string, unknown>;
        const kpiData = b.kpiData || {};
        
        // Build prompt from KPI data
        const trustGrade = (b.trustGrade as string) || 'B';
        const trustScore = (b.trustScore as number) || 65;
        const blocked = (b.blockedCount as number) || 0;
        const compliance = (b.compliancePct as number) || 0;
        const sessions = (b.activeSessions as number) || 0;
        const honeypotActive = (b.honeypotActive as number) || 0;
        const mesSignatures = (b.meshSignatures as number) || 0;
        const observing = (b.isObserving as boolean) || false;
        const policyCalls = (b.policyCalls as number) || 0;

        if (c && c.modelProvider && c.modelProvider.isAvailable()) {
          try {
            const systemPrompt = 'You are a security analyst explaining MCP server security metrics to a non-technical user. Keep explanations to 2-3 sentences. Use simple English.';
            const userPrompt = `My MCP server has these metrics:
- Overall Trust Score: ${trustGrade} (${trustScore}/100)
- Blocked attacks: ${blocked}
- Compliance score: ${compliance}% across SOC2/HIPAA/PCI-DSS/FedRAMP/ISO27001
- Active sessions: ${sessions}
- Honeypots active: ${honeypotActive}
- Threat signatures shared: ${mesSignatures}
- Policy observation: ${observing ? 'Active' : 'Idle'} (${policyCalls} calls observed)

Please write a 2-3 sentence summary of what these metrics mean. Also write a short explanation for each metric in simple English. Format your response as JSON: {"summary":"overall summary","metricExplanations":{"trustScore":"...","blockedAttacks":"...","compliance":"...","sessions":"...","honeypots":"...","threatMesh":"...","policyGen":"..."}}`;
            
            const response = await c.modelProvider.complete({
              systemPrompt,
              userPrompt,
              responseFormat: { type: 'json_object' },
              maxTokens: 512,
              temperature: 0.3,
            });

            if (response?.parsedJson) {
              writeJson(res, 200, { ok: true, analysis: response.parsedJson, llmUsed: true, model: response.model });
              return;
            }
          } catch (e) { /* fall through to heuristic */ }
        }

        // Heuristic fallback
        writeJson(res, 200, {
          ok: true,
          analysis: {
            summary: `Your MCP server has a ${trustGrade} trust score (${trustScore}/100). ${blocked > 0 ? `${blocked} attack(s) were blocked.` : 'No attacks detected.'} ${compliance > 0 ? `Compliance is at ${compliance}%.` : 'Compliance framework checks are pending.'}`,
            metricExplanations: {
              trustScore: `This measures how secure your MCP server is across 8 categories. Your grade is ${trustGrade} (${trustScore}/100). ${trustGrade === 'B' ? 'This is production-ready but could be improved with authentication.' : 'Review the improvement actions below.'}`,
              blockedAttacks: `${blocked} malicious requests were blocked by Mastyf AI's policy engine. Each blocked request represents a potential security threat that was stopped before reaching your server.`,
              compliance: `Compliance posture across 5 industry frameworks (SOC2, HIPAA, PCI-DSS, FedRAMP, ISO27001). Current score: ${compliance}%. These frameworks map to legal and regulatory requirements.`,
              sessions: `${sessions} active MCP sessions. Each session represents an AI client connected to your MCP server through Mastyf AI.`,
              honeypots: `${honeypotActive} fake decoy servers are deployed to detect and study attacker probing patterns.`,
              threatMesh: `${mesSignatures} anonymized threat signatures have been shared across the Mastyf AI network to protect all deployments.`,
              policyGen: policyCalls > 0 ? `Observing ${policyCalls} tool calls to automatically generate a minimal-privilege policy.` : 'Policy generation is idle. Start observation to automatically create security rules.',
            },
          },
          llmUsed: false,
        });
        return;
      }

      if (url === '/api/agentic/rl/reinforce' && method === 'POST') {
        setCors();
        const c = getAgenticContainer();
        if (!c) { writeJson(res, 200, { selectedStrategy: 'case_obfuscation', probability: 0.16, strategyProbabilities: [], totalEpisodes: 0 }); return; }
        writeJson(res, 200, c.reinforceFuzzer.select());
        return;
      }

      setCors(); writeJson(res, 404, { error: 'Not found' });
    } catch (err: unknown) { setCors(); writeJson(res, 500, { error: err instanceof Error ? err.message : String(err) }); }
  });

  let ws: WsBroadcaster | null = null;

  const listenPort = await new Promise<number | null>((resolve) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        Logger.warn(
          `[dashboard] Port ${port} already in use — proxy will run without local dashboard/WS. ` +
            `Stop the other process or set DASHBOARD_PORT / MASTYF_AI_WS_ENABLED=false.`,
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
    const pushMs = parseInt(process.env['MASTYF_AI_WS_PUSH_INTERVAL_MS'] || '5000', 10);
    ws.startDataPushLoop(pushMs);
  }
  const mode = dashboardEnabled ? 'dashboard + WS' : 'WS only';
  Logger.info(`[dashboard] ${mode} at http://localhost:${listenPort}/ws`);

  const handle = { auth, server, ws };
  activeDashboard = handle;

  try {
    const { applyAutopilotEnv } = await import('./autopilot-profile.js');
    const { startAutopilotServices } = await import('./autopilot-services.js');
    const { DEFAULT_TENANT_ID } = await import('../tenant/resolve-tenant.js');
    applyAutopilotEnv();
    startAutopilotServices(runtimeHistoryDb, process.env.MASTYF_AI_TENANT_ID || DEFAULT_TENANT_ID);
  } catch (err: unknown) {
    Logger.warn(
      `[autopilot] Service start skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

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
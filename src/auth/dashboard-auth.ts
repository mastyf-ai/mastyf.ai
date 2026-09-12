/**
 * Dashboard Authentication Middleware
 *
 * Provides JWT-based authentication for the dashboard HTTP API.
 * Supports:
 * - API key authentication (simple, internal deployments)
 * - JWT session tokens (for multi-user deployments)
 * - CSRF protection (double-submit cookie + Origin/Referer + X-CSRF-Token)
 * - Rate limiting on auth endpoints
 * - Login endpoint with configurable credential source
 *
 * Enabled by default when the dashboard is on. Disable for local dev only:
 * DASHBOARD_AUTH_DISABLED=true
 * Configure API key: DASHBOARD_API_KEY=<key>
 * Configure JWT secret: DASHBOARD_JWT_SECRET=<secret>
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { resolveTenantContext, DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { validateJwtTenantBinding } from '../tenant/jwt-tenant-binding.js';
import {
  getLicenseClient,
  isCloudLicenseKey,
} from '../license/license-client.js';
import {
  type DashboardRole,
  parseDashboardRolesEnv,
  resolveRolesForApiKey,
  resolveRolesFromSessionPayload,
} from './dashboard-rbac.js';

export interface AuthResult {
  authenticated: boolean;
  reason?: string;
  identity?: string;
  roles?: DashboardRole[];
  sessionTenantId?: string;
}

export interface DashboardAuthConfig {
  /** Enable authentication on dashboard API */
  enabled: boolean;
  /** Pre-shared API key (simplest auth) */
  apiKey?: string;
  /** JWT HMAC secret for session tokens */
  jwtSecret?: string;
  /** Session token expiry in seconds */
  sessionTtlSeconds: number;
  /** Allowed origins for CORS/CSRF validation */
  allowedOrigins: string[];
  /** Maximum login attempts per minute per IP */
  maxLoginAttemptsPerMinute: number;
}

/**
 * Rate limit tracker for login attempts.
 */
interface LoginRateEntry {
  count: number;
  resetAt: number;
}

/**
 * DashboardAuth provides authentication for the dashboard HTTP server.
 *
 * Two modes:
 * 1. API Key: Set DASHBOARD_API_KEY, pass as Authorization: Bearer <key> or X-API-Key header
 * 2. JWT Sessions: Set DASHBOARD_JWT_SECRET, POST /api/login with credentials
 */
export const CSRF_COOKIE_NAME = 'mastyf_ai_csrf';
export const SESSION_COOKIE_NAME = 'mastyf_ai_session';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export class DashboardAuth {
  private config: DashboardAuthConfig;
  private loginRateMap: Map<string, LoginRateEntry> = new Map();
  private activeTokens: LRUCache<string, true>;
  private sessionMeta: LRUCache<string, { tenantId: string; roles: DashboardRole[] }>;
  private apiKeyRoles: Map<string, DashboardRole> = parseDashboardRolesEnv();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<DashboardAuthConfig>) {
    const authDisabled = process.env['DASHBOARD_AUTH_DISABLED'] === 'true';
    const enabled =
      config?.enabled ??
      (!authDisabled && process.env['DASHBOARD_AUTH_ENABLED'] !== 'false');

    this.config = {
      enabled,
      apiKey: config?.apiKey ?? process.env['DASHBOARD_API_KEY'] ?? undefined,
      jwtSecret:
        config?.jwtSecret
        ?? process.env['DASHBOARD_JWT_SECRET']
        ?? process.env['MASTYF_AI_CLOUD_JWT_SECRET']
        ?? process.env['LICENSE_JWT_SECRET']
        ?? undefined,
      sessionTtlSeconds: config?.sessionTtlSeconds ?? 3600,
      allowedOrigins: config?.allowedOrigins ?? (process.env['DASHBOARD_ALLOWED_ORIGINS']
        ? process.env['DASHBOARD_ALLOWED_ORIGINS'].split(',').map(s => s.trim())
        : (process.env['MASTYF_AI_ENTERPRISE_MODE'] === 'true'
          ? ['https://localhost:4000']
          : ['http://localhost:4000', 'http://localhost:3000', 'http://127.0.0.1:4000'])),
      maxLoginAttemptsPerMinute: config?.maxLoginAttemptsPerMinute ?? 5,
    };

    const sessionTtlMs = this.config.sessionTtlSeconds * 1000;
    this.activeTokens = new LRUCache<string, true>({ max: 10_000, ttl: sessionTtlMs });
    this.sessionMeta = new LRUCache<string, { tenantId: string; roles: DashboardRole[] }>({ max: 10_000, ttl: sessionTtlMs });

    if (this.config.enabled && this.config.apiKey) {
      Logger.info('[dashboard-auth] API key authentication enabled');
    } else if (this.config.enabled && this.config.jwtSecret) {
      Logger.info('[dashboard-auth] JWT session authentication enabled');
    } else if (this.config.enabled) {
      Logger.error(
        '[dashboard-auth] Auth enabled but DASHBOARD_API_KEY or DASHBOARD_JWT_SECRET is required — API requests will be rejected until configured',
      );
    }

    // Periodic cleanup of rate limit entries
    if (this.config.enabled) {
      this.cleanupInterval = setInterval(() => this.cleanupRateMap(), 60000);
    }
  }

   /**
    * Authenticate a dashboard HTTP request.
    * Checks multiple sources:
    * 1. Authorization: Bearer <token> header
    * 2. Session cookie (browser login)
    * 3. X-API-Key header
    *
    * NOTE: Query string API key (?api_key=) is intentionally NOT supported
    * as query strings leak to access logs, browser history, and Referer headers.
    */
  authenticate(req: {
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    method?: string;
    /** Remote IP when available — used for appliance loopback bind */
    remoteAddress?: string;
  }): AuthResult {
    const requestTenantId = resolveTenantContext({ headers: req.headers }).tenantId;
    if (!this.config.enabled) {
      return { authenticated: true, identity: 'anonymous' };
    }

    const headers = this.normalizeHeaders(req.headers || {});

    // Phase 5.4 — appliance token is localhost-bound only.
    const applianceToken = process.env['MASTYF_APPLIANCE_TOKEN']?.trim();
    if (applianceToken) {
      const authHeader = headers['authorization'];
      const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
      const xAppliance = headers['x-mastyf-appliance-token'];
      const presented = bearer || (typeof xAppliance === 'string' ? xAppliance : undefined);
      if (presented && this.timingSafeCompare(presented, applianceToken)) {
        const remote = String(req.remoteAddress || headers['x-forwarded-for'] || '')
          .split(',')[0]
          .trim();
        const loopback =
          !remote ||
          remote === '127.0.0.1' ||
          remote === '::1' ||
          remote === '::ffff:127.0.0.1' ||
          remote === 'localhost';
        if (!loopback) {
          return {
            authenticated: false,
            reason: 'MASTYF_APPLIANCE_TOKEN is localhost-bound — rejected non-loopback peer',
          };
        }
        return {
          authenticated: true,
          identity: 'appliance_localhost',
          roles: ['operator'],
        };
      }
    }

    if (!this.config.apiKey && !this.config.jwtSecret && !applianceToken) {
      return {
        authenticated: false,
        reason: 'Dashboard authentication enabled but DASHBOARD_API_KEY or DASHBOARD_JWT_SECRET is not configured',
      };
    }

    const url = req.url || '/';

    // API keys are machine clients (Next rewrite, curl). CSRF stays on cookie sessions.
    const apiKeyResult = this.authenticateApiKey(headers);
    if (apiKeyResult) return apiKeyResult;

    // ── CSRF check for mutating requests (skipped when auth disabled) ──
    if (req.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && this.isCsrfEnforced()) {
      const csrfResult = this.validateCsrfRequest(headers);
      if (!csrfResult.authenticated) return csrfResult;
    }

    // ── Check Authorization header ──
    const authHeader = headers['authorization'];
    if (authHeader) {
      const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (bearerMatch) {
        const token = bearerMatch[1];

        // Cloud control plane API key (gcp_...) when configured (optional)
        if (isCloudLicenseKey(token)) {
          const license = getLicenseClient();
          const licenseOk =
            license.matchesLicenseKey(token)
            && (!license.isEnabled() || license.isLicensed());
          if (license.isEnabled() && licenseOk) {
            const tenant = license.getTenantSlug() ?? DEFAULT_TENANT_ID;
            const bind = validateJwtTenantBinding(requestTenantId, tenant);
            if (!bind.ok) {
              return { authenticated: false, reason: bind.reason };
            }
            return {
              authenticated: true,
              identity: 'cloud_license',
              roles: ['tenant-admin'],
              sessionTenantId: tenant,
            };
          }
        }

        // Check if it's a valid session token
        if (this.isActiveSession(token)) {
          const sessionTenant = this.getSessionTenantId(token);
          const bind = validateJwtTenantBinding(requestTenantId, sessionTenant);
          if (!bind.ok) {
            return { authenticated: false, reason: bind.reason };
          }
          return {
            authenticated: true,
            identity: 'session',
            roles: this.getSessionRoles(token),
            sessionTenantId: sessionTenant,
          };
        }
      }
    }

    // ── Check session cookie (browser login) ──
    const cookies = this.parseCookies(headers['cookie']);
    const sessionCookie = cookies[SESSION_COOKIE_NAME];
    if (sessionCookie && this.isActiveSession(sessionCookie)) {
      const sessionTenant = this.getSessionTenantId(sessionCookie);
      const bind = validateJwtTenantBinding(requestTenantId, sessionTenant);
      if (!bind.ok) {
        return { authenticated: false, reason: bind.reason };
      }
      return {
        authenticated: true,
        identity: 'session',
        roles: this.getSessionRoles(sessionCookie),
        sessionTenantId: sessionTenant,
      };
    }

    return { authenticated: false, reason: 'No valid authentication provided' };
  }

  private authenticateApiKey(headers: Record<string, string | undefined>): AuthResult | null {
    if (!this.config.apiKey) return null;
    const bearer = headers['authorization']?.match(/^Bearer\s+(.+)$/i)?.[1];
    const presented = bearer || headers['x-api-key'];
    if (!presented || !this.timingSafeCompare(presented, this.config.apiKey)) return null;
    return {
      authenticated: true,
      identity: 'api_key',
      roles: resolveRolesForApiKey(presented, this.apiKeyRoles),
    };
  }

  /**
   * Handle a login attempt. Creates a session token if credentials are valid.
   * Credentials are validated against DASHBOARD_USERNAME / DASHBOARD_PASSWORD env vars.
   */
  login(req: {
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    body?: { username?: string; password?: string; api_key?: string };
    ip?: string;
    /** Prior session cookie value — revoked on successful login (session fixation mitigation). */
    existingSessionToken?: string;
  }): { success: boolean; token?: string; error?: string } {
    if (!this.config.enabled || !this.config.jwtSecret) {
      return { success: false, error: 'JWT auth not configured. Set DASHBOARD_JWT_SECRET.' };
    }

    // ── Rate limit login attempts ──
    const ip = req.ip || 'unknown';
    const tenantId = resolveTenantContext({ headers: req.headers }).tenantId;
    if (!this.checkLoginRate(ip, tenantId)) {
      StructuredLogger.info({
        event: 'dashboard_login_rate_limited',
        ip,
        tenantId,
      });
      return { success: false, error: 'Too many login attempts. Try again later.' };
    }

    const body = req.body || {};

    // Invalidate pre-login session (session fixation mitigation)
    const priorSession = req.existingSessionToken;
    if (priorSession) {
      this.activeTokens.delete(priorSession);
    }

    // Check API key shortcut
    if (body.api_key && this.config.apiKey && this.timingSafeCompare(body.api_key, this.config.apiKey)) {
      const roles = resolveRolesForApiKey(body.api_key, this.apiKeyRoles);
      const token = this.createSessionToken(tenantId, roles);
      Logger.info(`[dashboard-auth] Login via API key from ${ip}`);
      return { success: true, token };
    }

    // Check username/password
    const expectedUsername = process.env['DASHBOARD_USERNAME'];
    const expectedPassword = process.env['DASHBOARD_PASSWORD'];

    if (!expectedUsername || !expectedPassword) {
      return { success: false, error: 'Login credentials not configured on server. Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD.' };
    }

    if (
      body.username &&
      body.password &&
      this.timingSafeCompare(body.username, expectedUsername) &&
      this.timingSafeCompare(body.password, expectedPassword)
    ) {
      const roles = this.sessionRolesFromLogin(body as { role?: string; roles?: string });
      const token = this.createSessionToken(tenantId, roles);
      if (priorSession) {
        void import('../audit/dashboard-access-log.js').then(({ appendSessionRotateAudit }) =>
          appendSessionRotateAudit({ tenantId, oldToken: priorSession, newToken: token }),
        );
      }
      StructuredLogger.info({
        event: 'dashboard_login',
        ip,
        identity: body.username,
        tenantId,
        roles,
      });
      return { success: true, token };
    }

    StructuredLogger.info({
      event: 'dashboard_login_failed',
      ip,
      identity: body.username || 'unknown',
    });

    return { success: false, error: 'Invalid credentials' };
  }

  /**
   * Revoke a session token (logout).
   */
  logout(token: string): void {
    this.activeTokens.delete(token);
    this.sessionMeta.delete(token);
  }

  /** Roles for an active session or API key identity (defaults to viewer when auth disabled). */
  getRolesForAuth(auth: AuthResult): DashboardRole[] {
    if (!this.config.enabled) return ['admin'];
    if (auth.roles?.length) return auth.roles;
    return ['viewer'];
  }

  /** Whether mutating requests require CSRF validation (auth on and configured). */
  isCsrfEnforced(): boolean {
    return this.requiresAuthentication() && this.isConfigured();
  }

  /** Issue a new CSRF token for double-submit cookie pattern. */
  issueCsrfToken(): string {
    return randomBytes(32).toString('hex');
  }

  /** Set-Cookie header value for the CSRF double-submit cookie. */
  csrfSetCookieHeader(token: string): string {
    const secure = process.env['MASTYF_AI_ENTERPRISE_MODE'] === 'true' ? '; Secure' : '';
    return `${CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=Strict; Max-Age=3600${secure}`;
  }

  /** Set-Cookie header value for the HttpOnly session cookie. */
  sessionSetCookieHeader(token: string): string {
    const secure = process.env['MASTYF_AI_ENTERPRISE_MODE'] === 'true' ? '; Secure' : '';
    return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${this.config.sessionTtlSeconds}${secure}`;
  }

  /**
   * Validate CSRF on mutating requests: allowed Origin/Referer + X-CSRF-Token matches cookie.
   */
  validateCsrfRequest(headers: Record<string, string | string[] | undefined>): AuthResult {
    if (!this.isCsrfEnforced()) {
      return { authenticated: true };
    }

    const normalized = this.normalizeHeaders(headers);
    const originResult = this.validateOriginReferer(normalized);
    if (!originResult.authenticated) return originResult;

    const cookies = this.parseCookies(normalized['cookie']);
    const cookieToken = cookies[CSRF_COOKIE_NAME];
    const headerToken = normalized[CSRF_HEADER_NAME];

    if (!cookieToken || !headerToken) {
      return { authenticated: false, reason: 'CSRF token required (cookie and X-CSRF-Token header)' };
    }

    if (!this.timingSafeCompare(headerToken, cookieToken)) {
      return { authenticated: false, reason: 'CSRF token mismatch' };
    }

    return { authenticated: true };
  }

  parseCookies(cookieHeader?: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!cookieHeader) return result;
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1);
      try {
        result[key] = decodeURIComponent(value);
      } catch {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Build request headers for CSRF validation from form body _csrf field.
   */
  csrfHeadersFromForm(
    baseHeaders: Record<string, string | string[] | undefined>,
    csrfFromBody?: string,
  ): Record<string, string | string[] | undefined> {
    if (!csrfFromBody) return baseHeaders;
    return { ...baseHeaders, [CSRF_HEADER_NAME]: csrfFromBody };
  }

  /**
   * Generate login page HTML (serves at /login when JWT auth is enabled).
   */
  getLoginPageHtml(error?: string, csrfToken?: string): string {
    const errorHtml = error ? `<div style="color:#f85149;margin-bottom:16px;padding:8px;background:#3d1f1f;border-radius:6px;">${error}</div>` : '';
    const csrfField = csrfToken
      ? `<input type="hidden" name="_csrf" value="${csrfToken}">`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MCP Mastyf AI — Login</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #c9d1d9; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
.container { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px; width: 100%; max-width: 400px; }
h1 { font-size: 20px; color: #58a6ff; margin-bottom: 8px; }
h2 { font-size: 14px; color: #8b949e; margin-bottom: 24px; }
label { display: block; font-size: 13px; color: #8b949e; margin-bottom: 4px; margin-top: 12px; }
input { width: 100%; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 14px; }
input:focus { outline: none; border-color: #58a6ff; }
button { width: 100%; padding: 10px; background: #238636; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; margin-top: 20px; }
button:hover { background: #2ea043; }
.footer { font-size: 12px; color: #8b949e; margin-top: 16px; text-align: center; }
</style>
</head>
<body>
<div class="container">
<h1>🛡️ Mastyf AI</h1>
<h2>Dashboard Authentication</h2>
${errorHtml}
<form method="POST" action="/api/login">
${csrfField}
<label for="username">Username</label>
<input type="text" id="username" name="username" required autofocus>
<label for="password">Password</label>
<input type="password" id="password" name="password" required>
<button type="submit">Sign In</button>
</form>
<div class="footer">Internal deployment — authorized access only</div>
</div>
</body>
</html>`;
  }

  /** Auth enforcement is on (may still lack credentials — then all requests are rejected). */
  requiresAuthentication(): boolean {
    return this.config.enabled;
  }

  /** Credentials are configured so successful login/API key checks can succeed. */
  isConfigured(): boolean {
    return !!(this.config.apiKey || this.config.jwtSecret);
  }

  /**
   * Check if auth is enabled and credentials are configured.
   */
  isEnabled(): boolean {
    return this.requiresAuthentication() && this.isConfigured();
  }

  /**
   * Check if JWT session-based auth is configured (vs API key only).
   */
  hasJwtSessionAuth(): boolean {
    return this.config.enabled && !!this.config.jwtSecret;
  }

  /**
   * Create a session from cloud SSO exchange (OAuth via control plane).
   */
  createCloudSession(
    tenantSlug: string,
    identity: string,
    roles: DashboardRole[] = ['tenant-admin'],
  ): string {
    if (!this.config.jwtSecret) {
      throw new Error(
        'Set DASHBOARD_JWT_SECRET or MASTYF_AI_CLOUD_JWT_SECRET (same value as cloud AUTH_SECRET)',
      );
    }
    Logger.info(`[dashboard-auth] Cloud session for ${identity} tenant=${tenantSlug}`);
    return this.createSessionToken(tenantSlug, roles);
  }

  /**
   * Authenticate a WebSocket upgrade request (session cookie or bearer token).
   */
  authenticateWebSocket(req: {
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
  }): AuthResult {
    return this.authenticate({ ...req, method: 'GET' });
  }

  /**
   * Create a signed HMAC session token (fresh jti on every login).
   */
  private createSessionToken(
    tenantId: string = DEFAULT_TENANT_ID,
    roles: DashboardRole[] = ['viewer'],
  ): string {
    const payload = Buffer.from(JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      jti: randomBytes(16).toString('hex'),
      tenant_id: tenantId,
      roles,
    })).toString('base64url');

    const secret = this.config.jwtSecret;
    if (!secret) {
      Logger.error('[dashboard-auth] Cannot create session: DASHBOARD_JWT_SECRET is not configured');
      throw new Error('DASHBOARD_JWT_SECRET is required to create session tokens');
    }

    const signature = createHmac('sha256', secret)
      .update(payload)
      .digest('base64url');

    const token = `${payload}.${signature}`;
    this.activeTokens.set(token, true);
    this.sessionMeta.set(token, { tenantId, roles });

    return token;
  }

  private sessionRolesFromLogin(body: { role?: string; roles?: string }): DashboardRole[] {
    if (body.roles) {
      try {
        const parsed = JSON.parse(body.roles) as string[];
        return resolveRolesFromSessionPayload({ roles: parsed });
      } catch {
        return resolveRolesFromSessionPayload({ roles: body.roles.split(',') });
      }
    }
    if (body.role) return resolveRolesFromSessionPayload({ role: body.role });
    const envRole = process.env['MASTYF_AI_DASHBOARD_LOGIN_ROLE'];
    if (envRole) return resolveRolesFromSessionPayload({ role: envRole });
    return ['viewer'];
  }

  /**
   * Timing-safe string comparison to prevent timing attacks on API keys.
   */
  private timingSafeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');
    // Pad to same length to avoid timing leak from length difference
    const maxLen = Math.max(bufA.length, bufB.length);
    const paddedA = Buffer.alloc(maxLen, 0);
    const paddedB = Buffer.alloc(maxLen, 0);
    bufA.copy(paddedA);
    bufB.copy(paddedB);
    return timingSafeEqual(paddedA, paddedB);
  }

  private isActiveSession(token: string): boolean {
    return this.activeTokens.has(token);
  }

  private parseSessionPayload(token: string): {
    tenant_id?: string;
    roles?: string[];
    role?: string;
  } | undefined {
    try {
      const [payloadB64] = token.split('.');
      if (!payloadB64) return undefined;
      return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
        tenant_id?: string;
        roles?: string[];
        role?: string;
      };
    } catch {
      return undefined;
    }
  }

  private getSessionTenantId(token: string): string | undefined {
    const meta = this.sessionMeta.get(token);
    if (meta) return meta.tenantId;
    return this.parseSessionPayload(token)?.tenant_id;
  }

  private getSessionRoles(token: string): DashboardRole[] {
    const meta = this.sessionMeta.get(token);
    if (meta?.roles?.length) return meta.roles;
    const json = this.parseSessionPayload(token);
    if (json) return resolveRolesFromSessionPayload(json);
    return ['viewer'];
  }

  /**
   * Validate Origin/Referer on mutating requests (required when CSRF is enforced).
   */
  private validateOriginReferer(headers: Record<string, string>): AuthResult {
    const origin = headers['origin'];
    const referer = headers['referer'];

    if (!origin && !referer) {
      return { authenticated: false, reason: 'Origin or Referer header required' };
    }

    if (origin) {
      if (!this.isAllowedOrigin(origin)) {
        return { authenticated: false, reason: `Origin '${origin}' not allowed` };
      }
    }

    if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        if (!this.isAllowedOrigin(refererOrigin)) {
          return { authenticated: false, reason: `Referer origin '${refererOrigin}' not allowed` };
        }
      } catch {
        return { authenticated: false, reason: 'Malformed Referer header' };
      }
    }

    return { authenticated: true };
  }

  private isAllowedOrigin(origin: string): boolean {
    return this.config.allowedOrigins.some(allowed => {
      if (allowed === '*') return true;
      if (allowed === origin) return true;
      return false;
    });
  }

  private loginRateKey(tenantId: string, ip: string): string {
    return `tenant:${tenantId || DEFAULT_TENANT_ID}:login:${ip}`;
  }

  private checkLoginRate(ip: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const key = this.loginRateKey(tenantId, ip);
    const now = Date.now();
    let entry = this.loginRateMap.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + 60000 };
      this.loginRateMap.set(key, entry);
      return true;
    }
    entry.count++;
    return entry.count <= this.config.maxLoginAttemptsPerMinute;
  }

  private normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) result[key.toLowerCase()] = value[0] || '';
      else if (value !== undefined) result[key.toLowerCase()] = value;
    }
    return result;
  }

  private cleanupRateMap(): void {
    const now = Date.now();
    for (const [ip, entry] of this.loginRateMap) {
      if (now > entry.resetAt) this.loginRateMap.delete(ip);
    }
  }

  dispose(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.activeTokens.clear();
    this.sessionMeta.clear();
    this.loginRateMap.clear();
  }
}

export type { DashboardRole } from './dashboard-rbac.js';

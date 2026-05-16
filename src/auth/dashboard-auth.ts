/**
 * Dashboard Authentication Middleware
 *
 * Provides JWT-based authentication for the dashboard HTTP API.
 * Supports:
 * - API key authentication (simple, internal deployments)
 * - JWT session tokens (for multi-user deployments)
 * - CSRF protection via Origin/Referer validation
 * - Rate limiting on auth endpoints
 * - Login endpoint with configurable credential source
 *
 * Enable with: DASHBOARD_AUTH_ENABLED=true
 * Configure API key: DASHBOARD_API_KEY=<key>
 * Configure JWT secret: DASHBOARD_JWT_SECRET=<secret>
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';

export interface AuthResult {
  authenticated: boolean;
  reason?: string;
  identity?: string;
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
 * 1. API Key: Set DASHBOARD_API_KEY, pass as ?api_key=<key> or Authorization: Bearer <key>
 * 2. JWT Sessions: Set DASHBOARD_JWT_SECRET, POST /api/login with credentials
 */
export class DashboardAuth {
  private config: DashboardAuthConfig;
  private loginRateMap: Map<string, LoginRateEntry> = new Map();
  private activeTokens: Set<string> = new Set();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<DashboardAuthConfig>) {
    const enabled = process.env['DASHBOARD_AUTH_ENABLED'] === 'true';

    this.config = {
      enabled: config?.enabled ?? enabled,
      apiKey: config?.apiKey ?? process.env['DASHBOARD_API_KEY'] ?? undefined,
      jwtSecret: config?.jwtSecret ?? process.env['DASHBOARD_JWT_SECRET'] ?? undefined,
      sessionTtlSeconds: config?.sessionTtlSeconds ?? 3600,
      allowedOrigins: config?.allowedOrigins ?? (process.env['DASHBOARD_ALLOWED_ORIGINS']
        ? process.env['DASHBOARD_ALLOWED_ORIGINS'].split(',').map(s => s.trim())
        : ['http://localhost:4000', 'http://localhost:3000', 'http://127.0.0.1:4000']),
      maxLoginAttemptsPerMinute: config?.maxLoginAttemptsPerMinute ?? 5,
    };

    if (this.config.enabled && this.config.apiKey) {
      Logger.info('[dashboard-auth] API key authentication enabled');
    } else if (this.config.enabled && this.config.jwtSecret) {
      Logger.info('[dashboard-auth] JWT session authentication enabled');
    } else if (this.config.enabled) {
      Logger.warn('[dashboard-auth] Auth enabled but no API key or JWT secret configured');
    }

    // Periodic cleanup of rate limit entries
    if (this.config.enabled) {
      this.cleanupInterval = setInterval(() => this.cleanupRateMap(), 60000);
    }
  }

  /**
   * Authenticate a dashboard HTTP request.
   * Checks multiple sources:
   * 1. ?api_key=<key> query parameter
   * 2. Authorization: Bearer <token> header
   * 3. X-API-Key: <key> header
   */
  authenticate(req: {
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    method?: string;
  }): AuthResult {
    if (!this.config.enabled) {
      return { authenticated: true, identity: 'anonymous' };
    }

    const url = req.url || '/';
    const headers = this.normalizeHeaders(req.headers || {});

    // ── CSRF check for mutating requests ──
    if (req.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const csrfResult = this.validateCsrf(headers);
      if (!csrfResult.authenticated) return csrfResult;
    }

    // ── Check query param API key ──
    try {
      const urlObj = new URL(url, 'http://localhost');
      const queryKey = urlObj.searchParams.get('api_key');
      if (queryKey && this.config.apiKey) {
        if (this.timingSafeCompare(queryKey, this.config.apiKey)) {
          return { authenticated: true, identity: 'api_key' };
        }
      }
    } catch {
      // Malformed URL — continue to other auth methods
    }

    // ── Check Authorization header ──
    const authHeader = headers['authorization'];
    if (authHeader) {
      const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (bearerMatch) {
        const token = bearerMatch[1];

        // Check if it's the API key
        if (this.config.apiKey && this.timingSafeCompare(token, this.config.apiKey)) {
          return { authenticated: true, identity: 'api_key' };
        }

        // Check if it's a valid session token
        if (this.activeTokens.has(token)) {
          return { authenticated: true, identity: 'session' };
        }
      }
    }

    // ── Check X-API-Key header ──
    const apiKeyHeader = headers['x-api-key'];
    if (apiKeyHeader && this.config.apiKey) {
      if (this.timingSafeCompare(apiKeyHeader, this.config.apiKey)) {
        return { authenticated: true, identity: 'api_key' };
      }
    }

    return { authenticated: false, reason: 'No valid authentication provided' };
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
  }): { success: boolean; token?: string; error?: string } {
    if (!this.config.enabled || !this.config.jwtSecret) {
      return { success: false, error: 'JWT auth not configured. Set DASHBOARD_JWT_SECRET.' };
    }

    // ── Rate limit login attempts ──
    const ip = req.ip || 'unknown';
    if (!this.checkLoginRate(ip)) {
      StructuredLogger.info({
        event: 'dashboard_login_rate_limited',
        ip,
      });
      return { success: false, error: 'Too many login attempts. Try again later.' };
    }

    const body = req.body || {};

    // Check API key shortcut
    if (body.api_key && this.config.apiKey && this.timingSafeCompare(body.api_key, this.config.apiKey)) {
      const token = this.createSessionToken();
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
      const token = this.createSessionToken();
      StructuredLogger.info({
        event: 'dashboard_login',
        ip,
        identity: body.username,
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
  }

  /**
   * Generate login page HTML (serves at /login when JWT auth is enabled).
   */
  getLoginPageHtml(error?: string): string {
    const errorHtml = error ? `<div style="color:#f85149;margin-bottom:16px;padding:8px;background:#3d1f1f;border-radius:6px;">${error}</div>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MCP Guardian — Login</title>
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
<h1>🛡️ MCP Guardian</h1>
<h2>Dashboard Authentication</h2>
${errorHtml}
<form method="POST" action="/api/login">
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

  /**
   * Check if auth is enabled and required.
   */
  isEnabled(): boolean {
    return this.config.enabled && !!(this.config.apiKey || this.config.jwtSecret);
  }

  /**
   * Check if JWT session-based auth is configured (vs API key only).
   */
  hasJwtSessionAuth(): boolean {
    return this.config.enabled && !!this.config.jwtSecret;
  }

  /**
   * Create a signed HMAC session token.
   */
  private createSessionToken(): string {
    const payload = Buffer.from(JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      jti: randomBytes(16).toString('hex'),
    })).toString('base64url');

    const signature = createHmac('sha256', this.config.jwtSecret || randomBytes(32).toString('hex'))
      .update(payload)
      .digest('base64url');

    const token = `${payload}.${signature}`;
    this.activeTokens.add(token);

    // Auto-expire after TTL
    setTimeout(() => this.activeTokens.delete(token), this.config.sessionTtlSeconds * 1000);

    return token;
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

  /**
   * Validate CSRF protection via Origin/Referer headers.
   */
  private validateCsrf(headers: Record<string, string>): AuthResult {
    const origin = headers['origin'];
    const referer = headers['referer'];

    // If both are missing and we're strict, could block
    // For now, only validate when present
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
        // Malformed referer — allow through
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

  private checkLoginRate(ip: string): boolean {
    const now = Date.now();
    let entry = this.loginRateMap.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + 60000 };
      this.loginRateMap.set(ip, entry);
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
    this.loginRateMap.clear();
  }
}
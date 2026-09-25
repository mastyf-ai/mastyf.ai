import { type DashboardRole } from './dashboard-rbac.js';
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
 * DashboardAuth provides authentication for the dashboard HTTP server.
 *
 * Two modes:
 * 1. API Key: Set DASHBOARD_API_KEY, pass as Authorization: Bearer <key> or X-API-Key header
 * 2. JWT Sessions: Set DASHBOARD_JWT_SECRET, POST /api/login with credentials
 */
export declare const CSRF_COOKIE_NAME = "mastyf_ai_csrf";
export declare const SESSION_COOKIE_NAME = "mastyf_ai_session";
export declare const CSRF_HEADER_NAME = "x-csrf-token";
export declare class DashboardAuth {
    private config;
    private loginRateMap;
    private activeTokens;
    private sessionMeta;
    private apiKeyRoles;
    private cleanupInterval;
    constructor(config?: Partial<DashboardAuthConfig>);
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
    }): AuthResult;
    private authenticateApiKey;
    /**
     * Handle a login attempt. Creates a session token if credentials are valid.
     * Credentials are validated against DASHBOARD_USERNAME / DASHBOARD_PASSWORD env vars.
     */
    login(req: {
        url?: string;
        headers?: Record<string, string | string[] | undefined>;
        body?: {
            username?: string;
            password?: string;
            api_key?: string;
        };
        ip?: string;
        /** Prior session cookie value — revoked on successful login (session fixation mitigation). */
        existingSessionToken?: string;
    }): {
        success: boolean;
        token?: string;
        error?: string;
    };
    /**
     * Revoke a session token (logout).
     */
    logout(token: string): void;
    /** Roles for an active session or API key identity (defaults to viewer when auth disabled). */
    getRolesForAuth(auth: AuthResult): DashboardRole[];
    /** Whether mutating requests require CSRF validation (auth on and configured). */
    isCsrfEnforced(): boolean;
    /** Issue a new CSRF token for double-submit cookie pattern. */
    issueCsrfToken(): string;
    /** Set-Cookie header value for the CSRF double-submit cookie. */
    csrfSetCookieHeader(token: string): string;
    /** Set-Cookie header value for the HttpOnly session cookie. */
    sessionSetCookieHeader(token: string): string;
    /**
     * Validate CSRF on mutating requests: allowed Origin/Referer + X-CSRF-Token matches cookie.
     */
    validateCsrfRequest(headers: Record<string, string | string[] | undefined>): AuthResult;
    parseCookies(cookieHeader?: string): Record<string, string>;
    /**
     * Build request headers for CSRF validation from form body _csrf field.
     */
    csrfHeadersFromForm(baseHeaders: Record<string, string | string[] | undefined>, csrfFromBody?: string): Record<string, string | string[] | undefined>;
    /**
     * Generate login page HTML (serves at /login when JWT auth is enabled).
     */
    getLoginPageHtml(error?: string, csrfToken?: string): string;
    /** Auth enforcement is on (may still lack credentials — then all requests are rejected). */
    requiresAuthentication(): boolean;
    /** Credentials are configured so successful login/API key checks can succeed. */
    isConfigured(): boolean;
    /**
     * Check if auth is enabled and credentials are configured.
     */
    isEnabled(): boolean;
    /**
     * Check if JWT session-based auth is configured (vs API key only).
     */
    hasJwtSessionAuth(): boolean;
    /**
     * Create a session from cloud SSO exchange (OAuth via control plane).
     */
    createCloudSession(tenantSlug: string, identity: string, roles?: DashboardRole[]): string;
    /**
     * Authenticate a WebSocket upgrade request (session cookie or bearer token).
     */
    authenticateWebSocket(req: {
        url?: string;
        headers?: Record<string, string | string[] | undefined>;
    }): AuthResult;
    /**
     * Create a signed HMAC session token (fresh jti on every login).
     */
    private createSessionToken;
    private sessionRolesFromLogin;
    /**
     * Timing-safe string comparison to prevent timing attacks on API keys.
     */
    private timingSafeCompare;
    private isActiveSession;
    private parseSessionPayload;
    private getSessionTenantId;
    private getSessionRoles;
    /**
     * Validate Origin/Referer on mutating requests (required when CSRF is enforced).
     */
    private validateOriginReferer;
    private isAllowedOrigin;
    private loginRateKey;
    private checkLoginRate;
    private normalizeHeaders;
    private cleanupRateMap;
    dispose(): void;
}
export type { DashboardRole } from './dashboard-rbac.js';
//# sourceMappingURL=dashboard-auth.d.ts.map
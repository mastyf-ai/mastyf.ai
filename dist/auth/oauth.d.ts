import { AuthConfig, AuthValidationResult, OIDCDiscovery } from './auth-types.js';
export declare class OAuthValidator {
    private config;
    private jwks;
    private cachedDiscovery;
    private discoveryFetchedAt;
    private jwksFetchedAt;
    private jwksUri;
    private backgroundRefreshTimer;
    constructor(config: AuthConfig);
    private discoveryTtlMs;
    private jwksRefreshMs;
    private isJwksStale;
    private refreshJwksFromUri;
    /** Refresh discovery + JWKS when TTL elapsed (before each validate). */
    ensureJwksFresh(force?: boolean): Promise<void>;
    /** Optional background JWKS refresh (call once after proxy OAuth init). */
    startBackgroundJwksRefresh(): void;
    stopBackgroundJwksRefresh(): void;
    private isJwksSignatureError;
    /**
     * Perform OIDC discovery to fetch JWKS URI from issuer (TTL-refreshed).
     */
    discover(force?: boolean): Promise<OIDCDiscovery>;
    /**
     * Initialize JWKS from discovery or explicit URI.
     */
    init(): Promise<void>;
    private verifyToken;
    /**
     * Validate a JWT bearer token and extract agent identity.
     */
    validate(token: string): Promise<AuthValidationResult>;
    /**
     * RFC 7662 token introspection when MASTYF_AI_OIDC_INTROSPECTION=true.
     * Returns true/false when introspection runs; null when skipped or unavailable.
     */
    private introspectTokenActive;
    /**
     * Extract Bearer token from Authorization header.
     */
    static extractToken(authorizationHeader?: string): string | null;
    /**
     * Extract Authorization from MCP JSON-RPC message (stdio and HTTP transports).
     * Supports: root Authorization, params._meta.auth, initialize clientInfo headers, env tokens.
     */
    static extractAuthFromMcpMessage(msg: Record<string, unknown>): string | undefined;
    getConfig(): AuthConfig;
}
//# sourceMappingURL=oauth.d.ts.map
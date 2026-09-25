/**
 * OAuth 2.1 / OIDC authentication types for MCP Mastyf AI proxy.
 */
export interface AuthConfig {
    /** OIDC issuer URL (e.g., https://accounts.google.com) */
    issuer: string;
    /** Expected audience claim in JWT */
    audience: string;
    /** Whether authentication is required (fail-closed) or optional (fail-open) */
    required: boolean;
    /** JWKS URI override (default: auto-discovered from issuer) */
    jwksUri?: string;
    /** Clock tolerance in seconds for JWT validation */
    clockTolerance?: number;
}
export interface AgentIdentity {
    /** Subject claim (sub) — unique agent identifier */
    sub: string;
    /** Client ID from the token */
    clientId?: string;
    /** Scopes granted to this agent */
    scopes?: string[];
    /** Issuer of the token */
    issuer: string;
    /** Token expiry timestamp */
    expiresAt?: number;
    /** Tenant id from JWT claim (MASTYF_AI_JWT_TENANT_CLAIM, default tenant_id) */
    tenantId?: string;
}
export interface AuthValidationResult {
    valid: boolean;
    identity?: AgentIdentity;
    error?: string;
}
export interface OIDCDiscovery {
    issuer: string;
    jwks_uri: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    introspection_endpoint?: string;
    scopes_supported?: string[];
}
//# sourceMappingURL=auth-types.d.ts.map
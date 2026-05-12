/**
 * OAuth 2.1 / OIDC JWT Validator for MCP Guardian proxy.
 *
 * Validates bearer tokens from MCP requests against an OIDC provider.
 * Uses OIDC Discovery (RFC 8414) to auto-configure JWKS endpoint.
 * Supports Client Credentials flow (most common for server-to-agent MCP).
 */
import * as jose from 'jose';
import { AuthConfig, AuthValidationResult, AgentIdentity, OIDCDiscovery } from './auth-types.js';
import { StructuredLogger } from '../utils/structured-logger.js';

export class OAuthValidator {
  private config: AuthConfig;
  private jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
  private cachedDiscovery: OIDCDiscovery | null = null;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  /**
   * Perform OIDC discovery to fetch JWKS URI from issuer.
   */
  async discover(): Promise<OIDCDiscovery> {
    if (this.cachedDiscovery) return this.cachedDiscovery;

    const discoveryUrl = `${this.config.issuer}/.well-known/openid-configuration`;
    try {
      const res = await fetch(discoveryUrl);
      if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
      const meta = (await res.json()) as OIDCDiscovery;
      this.cachedDiscovery = meta;
      StructuredLogger.info({ event: 'oidc_discovery', issuer: this.config.issuer, jwks_uri: meta.jwks_uri });
      return meta;
    } catch (err: any) {
      StructuredLogger.logError({ event: 'oidc_discovery_error', serverName: 'oauth', error: `Failed to discover OIDC config: ${err?.message}` });
      throw err;
    }
  }

  /**
   * Initialize JWKS from discovery or explicit URI.
   */
  async init(): Promise<void> {
    let jwksUri = this.config.jwksUri;
    if (!jwksUri) {
      const discovery = await this.discover();
      jwksUri = discovery.jwks_uri;
    }
    this.jwks = jose.createRemoteJWKSet(new URL(jwksUri));
  }

  /**
   * Validate a JWT bearer token and extract agent identity.
   */
  async validate(token: string): Promise<AuthValidationResult> {
    if (!this.jwks) {
      try {
        await this.init();
      } catch (err: any) {
        return { valid: false, error: `Auth provider unreachable: ${err?.message}` };
      }
    }

    if (!this.jwks) {
      return { valid: false, error: 'JWKS not initialized' };
    }

    try {
      // ═══ GAP 11: JWT algorithm pinning — prevents algorithm confusion attacks ═══
      const ALLOWED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'PS256'];
      const { payload } = await jose.jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ALLOWED_ALGORITHMS,
        clockTolerance: this.config.clockTolerance || 30,
      });

      const identity: AgentIdentity = {
        sub: payload.sub || 'unknown',
        clientId: (payload as any).client_id || (payload as any).azp,
        scopes: (payload as any).scope ? String((payload as any).scope).split(' ') : undefined,
        issuer: payload.iss || this.config.issuer,
        expiresAt: payload.exp ? payload.exp * 1000 : undefined,
      };

      return { valid: true, identity };
    } catch (err: any) {
      return { valid: false, error: `JWT validation failed: ${err?.message}` };
    }
  }

  /**
   * Extract Bearer token from Authorization header.
   */
  static extractToken(authorizationHeader?: string): string | null {
    if (!authorizationHeader) return null;
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
  }

  getConfig(): AuthConfig {
    return this.config;
  }
}
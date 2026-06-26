/**
 * Per-request state for stdio proxy — keyed by JSON-RPC id (concurrent tools/call safe).
 */
import {
  captureEphemeralSecrets,
  runWithEphemeralCredentialVault,
} from '../security/ephemeral-credential-vault.js';

export interface ProxyRequestContext {
  requestStartTime: number;
  requestToolName: string;
  requestMethod?: string;
  requestTokens: number;
  requestRaw: string;
  requestModel?: string;
  requestArguments?: Record<string, unknown>;
  sessionId?: string;
  agentId?: string;
  /** Resolved tenant for per-tenant circuit breaker / audit isolation */
  tenantId?: string;
  agentIdentity?: import('../auth/auth-types.js').AgentIdentity;
  /** Rotated MCP session token (L-6) returned to client in response _meta */
  rotatedSessionToken?: string;
  /** Geo region from inbound HTTP headers */
  geoRegion?: string;
  hourUtc?: number;
  /** Unified spend pool reservation — release on block/error, commit on persist */
  spendReservationId?: string;
}

export class ProxyRequestContextStore {
  private pending = new Map<string | number, ProxyRequestContext>();

  set(id: string | number, ctx: ProxyRequestContext): void {
    this.pending.set(id, ctx);
  }

  get(id: string | number): ProxyRequestContext | undefined {
    return this.pending.get(id);
  }

  delete(id: string | number): ProxyRequestContext | undefined {
    const ctx = this.pending.get(id);
    if (ctx) this.pending.delete(id);
    return ctx;
  }

  clear(): void {
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}

/** Capture provider-shaped secrets from request body/headers for log redaction (in-flight only). */
export function captureRequestSecrets(
  body?: string,
  headers?: Record<string, string | string[] | undefined>,
): void {
  if (body) captureEphemeralSecrets(body);
  if (!headers) return;
  const auth = headers['authorization'];
  const authVal = Array.isArray(auth) ? auth.join(' ') : auth;
  if (authVal) captureEphemeralSecrets(authVal);
  const apiKey = headers['x-api-key'];
  const keyVal = Array.isArray(apiKey) ? apiKey.join(' ') : apiKey;
  if (keyVal) captureEphemeralSecrets(keyVal);
}

/** Scope ephemeral credential vault to a single proxy request lifecycle. */
export function withProxyRequestVault<T>(
  body: string | undefined,
  headers: Record<string, string | string[] | undefined> | undefined,
  fn: () => T,
): T {
  return runWithEphemeralCredentialVault(() => {
    captureRequestSecrets(body, headers);
    return fn();
  });
}

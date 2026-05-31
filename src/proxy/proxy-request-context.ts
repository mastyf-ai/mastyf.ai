/**
 * Per-request state for stdio proxy — keyed by JSON-RPC id (concurrent tools/call safe).
 */
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

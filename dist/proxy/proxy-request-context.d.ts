export interface ProxyRequestContext {
    requestStartTime: number;
    createdAt: number;
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
export declare function proxyContextTtlMs(defaultTimeoutMs: number): number;
/** Release unified spend pool reservation without awaiting (best-effort). */
export declare function releaseSpendReservation(ctx: ProxyRequestContext | undefined): void;
type TimeoutHandler = (id: string | number, ctx: ProxyRequestContext) => void;
export declare class ProxyRequestContextStore {
    private pending;
    private timers;
    set(id: string | number, ctx: ProxyRequestContext): void;
    get(id: string | number): ProxyRequestContext | undefined;
    delete(id: string | number, releaseSpend?: boolean): ProxyRequestContext | undefined;
    clear(releaseSpend?: boolean): void;
    get size(): number;
    armTimeout(id: string | number, ms: number, onExpire: TimeoutHandler): void;
    clearTimeout(id: string | number): void;
    clearAllTimeouts(): void;
    evictExpired(maxAgeMs: number, onExpire: TimeoutHandler): number;
    drain(onEach: (id: string | number, ctx: ProxyRequestContext) => void): void;
    ids(): Array<string | number>;
}
/** Capture provider-shaped secrets from request body/headers for log redaction (in-flight only). */
export declare function captureRequestSecrets(body?: string, headers?: Record<string, string | string[] | undefined>): void;
/** Scope ephemeral credential vault to a single proxy request lifecycle. */
export declare function withProxyRequestVault<T>(body: string | undefined, headers: Record<string, string | string[] | undefined> | undefined, fn: () => T): T;
export {};
//# sourceMappingURL=proxy-request-context.d.ts.map
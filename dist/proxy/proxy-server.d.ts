import { IDatabase } from '../database/database-interface.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { OAuthValidator } from '../auth/oauth.js';
import type { TenantPolicyRegistry } from '../policy/tenant-policy-registry.js';
/**
 * MCP Proxy Interceptor — sits between the AI client and an MCP server.
 *
 * v0.4: Integrated PolicyEngine for active blocking of malicious tool calls.
 * v0.5: OAuth 2.1 JWT validation — validates bearer tokens before policy evaluation.
 * v0.5.2: Circuit breaker for upstream MCP server failures.
 * v0.5.2: Per-client rate limiting (keyed by agent sub + tool name).
 * v0.5.2: Consistent SIEM fields (request_id, proxy_latency_ms, authn_success, authz_allowed).
 * v2.2: Payload size guard (MAX_PAYLOAD_BYTES) + exponential backoff on child restart.
 */
export declare class McpProxyServer {
    private child;
    private tokenCounter;
    private db;
    private currentRequestId;
    private readonly requestContexts;
    private readonly stdoutWriter;
    private readonly responseTracker;
    private readonly sessionAuth;
    private contextTtlTimer;
    private serverName;
    private defaultTenantId;
    private policyEngine;
    private pendingPolicyEngine;
    private policyEvalInflight;
    private tenantPolicyRegistry;
    private authValidator;
    private sessionCache;
    private readonly clientInputQueue;
    private stopMemoryMonitor;
    /** OWASP MCP03 rug-pull fingerprint state (tools/list). */
    private rugPullState;
    /** Pending tools/list JSON-RPC ids awaiting correlated responses. */
    private pendingToolsListIds;
    /**
     * Internal resources/list ids issued by the proxy after tools/list —
     * responses are persisted for AI Access and never forwarded to the client.
     */
    private pendingInternalResourceListIds;
    private resourcesListIssued;
    private mcpSessionId;
    private mcpAgentId;
    private requestTimeoutMs;
    private restartCount;
    private maxRestarts;
    private spawnCommand;
    private spawnArgs;
    private spawnEnv;
    constructor(command: string, args: string[], env: Record<string, string>, db: IDatabase, serverName?: string, policyEngine?: PolicyEngine, authValidator?: OAuthValidator, requestTimeoutMs?: number, maxRestarts?: number, tenantPolicyRegistry?: TenantPolicyRegistry);
    private breakerFor;
    private spawnChild;
    get stdin(): NodeJS.WritableStream | null;
    private setupStdout;
    /**
     * After tools/list, issue an internal resources/list so AI Access can show
     * a live inventory without inventing URIs. Response is not forwarded to clients.
     */
    private issueProactiveResourcesList;
    private handleStdoutLine;
    private setupStderr;
    private sendError;
    private failAllPendingRequests;
    private resolveOrphanResponseId;
    private handleRequestTimeout;
    private armRequestTimeout;
    private clearRequestTimeout;
    private recordDeniedCall;
    /**
     * Called when the AI client writes a request to be proxied.
     * Pipeline: Payload guard → Auth → Circuit Breaker → Policy + RBAC → Forward.
     */
    handleClientInput(raw: string): Promise<void>;
    private processClientInput;
    /** Atomically swap the active policy engine (used by hot-reload) */
    setPolicyEngine(engine: PolicyEngine): void;
    private evaluatePolicyPinned;
    kill(): void;
}
//# sourceMappingURL=proxy-server.d.ts.map
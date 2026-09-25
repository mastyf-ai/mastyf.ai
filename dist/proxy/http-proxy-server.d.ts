import { HistoryDatabase } from '../database/history-db.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { OAuthValidator } from '../auth/oauth.js';
import type { MtlsConfig } from '../utils/mtls-config.js';
/**
 * HTTP/SSE Proxy for remote MCP servers.
 * Reuses the same auth, policy, circuit breaker, and metrics stack as the stdio proxy.
 */
export declare class HttpProxyServer {
    private serverName;
    private targetUrl;
    private policyEngine;
    private authValidator;
    private sessionCache;
    private defaultTenantId;
    private tokenCounter;
    private db;
    private port;
    private inboundTls;
    private server;
    private readonly rugPullState;
    constructor(targetUrl: string, serverName: string, policyEngine?: PolicyEngine, authValidator?: OAuthValidator, db?: HistoryDatabase, port?: number, mtlsConfig?: MtlsConfig);
    start(): Promise<void>;
    private breakerFor;
    private handleRequest;
    private dispatchRequest;
    getPort(): number;
    getServerName(): string;
    getTargetUrl(): string;
    stop(): Promise<void>;
}
//# sourceMappingURL=http-proxy-server.d.ts.map
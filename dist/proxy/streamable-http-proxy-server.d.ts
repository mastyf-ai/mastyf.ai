import { PolicyEngine } from '../policy/policy-engine.js';
import { OAuthValidator } from '../auth/oauth.js';
import type { IDatabase } from '../database/database-interface.js';
export interface StreamableHttpProxyOptions {
    listenPort: number;
    upstreamBaseUrl: string;
    serverName: string;
    policy?: PolicyEngine;
    db?: IDatabase;
    authValidator?: OAuthValidator;
    /** When true, POST /mcp requests are relayed to upstreamBaseUrl/mcp. */
    upstreamRelay?: boolean;
}
export declare class StreamableHttpProxyServer {
    private opts;
    private httpServer;
    private boundPort;
    private sessionCache;
    private tokenCounter;
    private readonly rugPullState;
    private readonly upstreamRelay;
    constructor(opts: StreamableHttpProxyOptions);
    getListenPort(): number;
    start(): Promise<number>;
    stop(): Promise<void>;
    private handleRequest;
    private processMessage;
    private processMessageTraced;
    private relayToUpstream;
    private maybeBlockMessage;
}
//# sourceMappingURL=streamable-http-proxy-server.d.ts.map
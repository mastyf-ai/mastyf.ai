import { PolicyEngine } from '../policy/policy-engine.js';
import type { IDatabase } from '../database/database-interface.js';
import { OAuthValidator } from '../auth/oauth.js';
export interface WebSocketProxyOptions {
    listenPort: number;
    upstreamWsUrl: string;
    serverName: string;
    policy?: PolicyEngine;
    db?: IDatabase;
    authValidator?: OAuthValidator;
}
export declare class WebSocketProxyServer {
    private opts;
    private httpServer;
    private wss;
    private rugPullState;
    private pendingToolCalls;
    private pendingToolArgs;
    private pendingMcpMethods;
    private pendingMcpSessions;
    private pendingToolTenants;
    private pendingStreamingCost;
    private pendingSessionTokens;
    private sessionCache;
    private tokenCounter;
    constructor(opts: WebSocketProxyOptions);
    private applyRotatedSessionToMessage;
    start(): Promise<void>;
    getListenPort(): number;
    stop(): Promise<void>;
    private breakerFor;
    private handleClientConnection;
    private interceptUpstreamMessage;
    private interceptMessage;
    private interceptMessageInner;
    private evaluateToolCall;
}
//# sourceMappingURL=websocket-proxy-server.d.ts.map
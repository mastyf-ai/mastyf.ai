import http from 'http';
import { EventEmitter } from 'events';
import { URL } from 'url';
import { PolicyEngine } from '../policy/policy-engine.js';
import type { MtlsConfig } from '../utils/mtls-config.js';
interface SseProxyOptions {
    upstreamUrl: string;
    serverName: string;
    policy?: PolicyEngine;
    db: import('../database/database-interface.js').IDatabase;
    authHeader?: string;
    mtlsConfig?: MtlsConfig;
    /** Local listen port (0 = ephemeral). Set via MASTYF_AI_SSE_PROXY_PORT or config. */
    listenPort?: number;
}
interface SseSession {
    id: string;
    upstreamSessionId: string;
    upstreamMessageUrl: URL;
    upstreamSseReq?: http.ClientRequest;
    createdAt: number;
}
/**
 * MCP HTTP+SSE transport proxy.
 * - GET /sse (or /) — long-lived event stream; relays upstream SSE; exposes local /message endpoint
 * - POST /message?sessionId=... — JSON-RPC with policy + token accounting on tools/call
 * - interceptAndForward() — programmatic API (tests, direct integration)
 */
export declare class SseProxyServer extends EventEmitter {
    private opts;
    private tokenCounter;
    private sessions;
    private httpServer;
    private boundPort;
    private readonly rugPullState;
    constructor(opts: SseProxyOptions);
    getListenPort(): number;
    start(listenPort?: number): Promise<number>;
    stop(): Promise<void>;
    private handleHttpRequest;
    private handleSseGet;
    private handleMessagePost;
    private discoverUpstreamSession;
    interceptAndForward(jsonRpcRequest: Record<string, unknown>, requestHeaders?: Record<string, string | string[] | undefined>, session?: SseSession): Promise<Record<string, unknown>>;
    private _forwardToUpstream;
}
export {};
//# sourceMappingURL=sse-proxy-server.d.ts.map
/**
 * HTTP/SSE Transparent Proxy for Cost Auditing (v2.1).
 *
 * Intercepts HTTP requests to upstream MCP servers, inspects JSON-RPC tools/call
 * payloads, runs token counting and policy evaluation, then forwards to the target.
 */
import * as http from 'http';
import * as https from 'https';
import type { Agent } from 'https';
import type { HttpProxyAuthValidator } from './http-proxy-auth.js';
import type { ToolCallDefenseHook } from './tool-call-defense-hook.js';
interface TokenCounterLike {
    count(text: string): number;
}
interface PolicyEngineLike {
    evaluate(c: any): {
        action: string;
        rule: string;
        reason: string;
    };
    evaluateAsync?(c: any): Promise<{
        action: string;
        rule: string;
        reason: string;
    }>;
}
interface DatabaseLike {
    addCallRecord(r: any): Promise<void>;
}
export interface CreateHttpProxyOptions {
    authValidator?: HttpProxyAuthValidator | null;
    maxBodyBytes?: number;
    upstreamTimeoutMs?: number;
    tls?: {
        cert: Buffer | string;
        key: Buffer | string;
    };
    upstreamAgent?: Agent;
    /** Full Defense Fabric pipeline (monorepo bridge). When set, replaces basic policy-only check. */
    defenseHook?: ToolCallDefenseHook | null;
    serverName?: string;
    tenantId?: string;
}
export declare function createHttpProxy(targetUrl: string, policyEngine: PolicyEngineLike | null, db: DatabaseLike, tokenCounter: TokenCounterLike, options?: CreateHttpProxyOptions): http.Server | https.Server;
export type { HttpProxyAuthValidator } from './http-proxy-auth.js';

import type { McpMethod } from '../agentic/mcp-lifecycle/lifecycle-guard.js';
export declare function normalizeMcpMethod(method: string | undefined): McpMethod | null;
export interface LifecycleCheckResult {
    allowed: boolean;
    reason?: string;
    sessionId: string;
    agentId: string;
}
export declare function runMcpLifecyclePreCheck(params: {
    method: string;
    serverName: string;
    msg: Record<string, unknown>;
    authenticated: boolean;
    fallbackSessionKey?: string;
}): LifecycleCheckResult;
export declare function recordMcpLifecycleRequest(params: {
    sessionId: string;
    method: string;
    blocked: boolean;
    toolName?: string;
    argsSummary?: string;
    latencyMs?: number;
    userId?: string;
}): void;
/** Scan upstream resource/prompt JSON-RPC results before returning to client. */
export declare function gateMcpMethodResponse(params: {
    method: string;
    result: unknown;
}): {
    blocked: boolean;
    reason?: string;
    sanitized?: unknown;
};
//# sourceMappingURL=mcp-lifecycle-bridge.d.ts.map
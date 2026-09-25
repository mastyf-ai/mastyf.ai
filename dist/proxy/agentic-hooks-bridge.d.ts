/**
 * Bridge from proxy transports to agentic container hooks.
 */
import type { IncomingHttpHeaders } from 'http';
import { type AgenticToolCallContext } from '../agentic/proxy-integration.js';
export type { AgenticToolCallContext };
export declare function agenticPreForwardToolCall(serverName: string, toolName: string, args: Record<string, unknown> | undefined, ctx: AgenticToolCallContext | string, legacyAgentId?: string): Promise<{
    blocked: boolean;
    sanitizedArgs?: Record<string, unknown>;
    reason?: string;
}>;
export declare function agenticRecordDeniedToolCall(params: {
    serverName: string;
    sessionId: string;
    toolName: string;
    args?: Record<string, unknown>;
    latencyMs: number;
    blockRule?: string;
    blockReason?: string;
}): void;
export declare function agenticRecordCompletedToolCall(params: {
    serverName: string;
    sessionId: string;
    toolName: string;
    args?: Record<string, unknown>;
    latencyMs: number;
    blocked: boolean;
    blockReason?: string;
    responseSize?: number;
    agentId?: string;
}): Promise<void>;
/** Build session context for fleet chain correlation across MCP servers. */
export declare function buildAgenticToolCallContext(params: {
    requestId: string;
    agentId?: string;
    mcpSessionId?: string;
    meta?: Record<string, unknown>;
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
}): AgenticToolCallContext;
//# sourceMappingURL=agentic-hooks-bridge.d.ts.map
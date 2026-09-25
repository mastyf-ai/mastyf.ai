import type { IncomingHttpHeaders } from 'http';
export type ToolCallPreGuardResult = {
    blocked: false;
    arguments?: Record<string, unknown>;
} | {
    blocked: true;
    code: number;
    message: string;
};
export declare function runToolCallPreForwardGuard(serverName: string, toolName: string, args: Record<string, unknown> | undefined, requestId: string, opts?: {
    agentId?: string;
    mcpSessionId?: string;
    meta?: Record<string, unknown>;
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
}): Promise<ToolCallPreGuardResult>;
/** JSON-RPC error object for transports that return Record responses. */
export declare function toolCallGuardBlockResponse(id: unknown, guard: Extract<ToolCallPreGuardResult, {
    blocked: true;
}>): Record<string, unknown>;
//# sourceMappingURL=tool-call-pre-guard.d.ts.map
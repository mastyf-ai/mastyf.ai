import type { IncomingHttpHeaders } from 'http';
import type { BlockEvidence } from './block-evidence.js';
export type ToolCallPreGuardResult = {
    blocked: false;
    arguments?: Record<string, unknown>;
} | {
    blocked: true;
    code: number;
    message: string;
    evidence?: BlockEvidence;
};
export declare function runToolCallPreForwardGuard(serverName: string, toolName: string, args: Record<string, unknown> | undefined, requestId: string, opts?: {
    localStdio?: boolean;
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
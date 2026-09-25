export interface McpPipelineSession {
    sessionId: string;
    agentId: string;
}
export type McpPrePipelineResult = {
    blocked: false;
    session: McpPipelineSession;
    trackResponse?: boolean;
    requestMethod?: string;
} | {
    blocked: true;
    response: Record<string, unknown>;
};
export declare function runMcpPrePipeline(params: {
    msg: Record<string, unknown>;
    serverName: string;
    authenticated: boolean;
    fallbackSessionKey?: string;
}): McpPrePipelineResult;
export declare function applyMcpResponsePipeline(params: {
    method: string;
    result: unknown;
    sessionId: string;
    latencyMs?: number;
}): {
    blocked: boolean;
    reason?: string;
    result?: unknown;
};
export declare function mcpResponseBlockJson(id: string | number | null | undefined, reason: string): Record<string, unknown>;
//# sourceMappingURL=mcp-request-pipeline.d.ts.map
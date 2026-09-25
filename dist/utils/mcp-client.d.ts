import { McpServerConfig } from '../types.js';
export interface McpToolDefinition {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}
export interface McpProbeResult {
    success: boolean;
    toolCount?: number;
    toolNames?: string[];
    /** Full tool definitions from tools/list (for audit cost estimation). */
    tools?: McpToolDefinition[];
    authRequired: boolean;
    latencyMs: number;
    serverVersion?: string;
    error?: string;
}
export declare class McpClient {
    private static handshakeTimeoutMs;
    private static sseTimeoutMs;
    static probe(server: McpServerConfig): Promise<McpProbeResult>;
    /**
     * Full stdio JSON-RPC handshake: initialize → initialized → tools/list.
     */
    private static probeStdio;
    /**
     * Full MCP-over-SSE handshake:
     * 1. GET SSE endpoint → parse sessionId from event stream
     * 2. POST initialize to /message?sessionId=...
     * 3. POST tools/list to /message?sessionId=...
     * Returns actual tool count from server — no hardcoded values.
     */
    private static SSE_PER_PATH_TIMEOUT_MS;
    private static probeSse;
    /**
     * Discover SSE session ID by probing multiple paths (/, /sse, /message)
     * with individual per-path timeouts so a hung TCP connection doesn't
     * exhaust the global timeout.
     */
    private static discoverSessionId;
    /**
     * GET the SSE endpoint, parse the event stream for a sessionId.
     */
    private static getSessionId;
    private static postJson;
}
//# sourceMappingURL=mcp-client.d.ts.map
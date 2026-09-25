/**
 * Resolve a stable global session id for cross-MCP fleet chain correlation (A1).
 */
import type { IncomingHttpHeaders } from 'http';
export interface GlobalSessionInput {
    agentId?: string;
    mcpSessionId?: string;
    requestId: string;
    meta?: Record<string, unknown>;
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
}
/** Stable key spanning tool calls and MCP servers for fleet chain graphs. */
export declare function resolveGlobalSessionId(input: GlobalSessionInput): string;
export declare function fleetChainBlockConfidenceThreshold(): number;
/** Per-request fallback ids cannot correlate cross-server chains. */
export declare function isEphemeralRequestSession(globalSessionId: string): boolean;
/** Derive agent id for fleet chain events when JWT sub is absent. */
export declare function deriveAgentIdForFleetChain(globalSessionId: string, agentId?: string): string;
//# sourceMappingURL=global-session-id.d.ts.map
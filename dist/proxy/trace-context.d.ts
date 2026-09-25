import type { IncomingHttpHeaders } from 'http';
export type TraceTransport = 'http' | 'sse' | 'streamable-http' | 'stdio' | 'websocket';
/** Run fn with W3C trace context extracted from inbound HTTP headers. */
export declare function runWithExtractedTrace<T>(headers: Record<string, string | string[] | undefined> | IncomingHttpHeaders | undefined, fn: () => T): T;
/** Async variant of {@link runWithExtractedTrace}. */
export declare function runWithExtractedTraceAsync<T>(headers: Record<string, string | string[] | undefined> | IncomingHttpHeaders | undefined, fn: () => Promise<T>): Promise<T>;
/** Merge traceparent (and related) headers into outbound upstream request headers. */
export declare function injectIntoUpstreamHeaders(headers: Record<string, string | string[] | undefined>, overrides?: Record<string, string>): Record<string, string | string[]>;
export interface ToolCallSpanAttrs {
    serverName: string;
    toolName: string;
    tenantId?: string;
    transport: TraceTransport;
    decision?: string;
}
/** Active span for MCP tools/call handling (policy + upstream relay). */
export declare function withMcpToolCallSpan<T>(attrs: ToolCallSpanAttrs, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=trace-context.d.ts.map
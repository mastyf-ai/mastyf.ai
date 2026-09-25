/** True when the MCP URL targets streamable HTTP (POST /mcp), not classic SSE. */
export declare function isStreamableHttpMcpUrl(url: string): boolean;
/** Strip a trailing /mcp path segment for StreamableHttpProxyServer upstreamBaseUrl. */
export declare function resolveStreamableHttpUpstreamBase(url: string): string;
//# sourceMappingURL=mcp-transport-url.d.ts.map
/** True when the MCP URL targets streamable HTTP (POST /mcp), not classic SSE. */
export function isStreamableHttpMcpUrl(url) {
    try {
        const pathname = new URL(url).pathname.replace(/\/$/, '') || '/';
        return pathname === '/mcp' || pathname.endsWith('/mcp');
    }
    catch {
        return false;
    }
}
/** Strip a trailing /mcp path segment for StreamableHttpProxyServer upstreamBaseUrl. */
export function resolveStreamableHttpUpstreamBase(url) {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    if (path.endsWith('/mcp')) {
        u.pathname = path.slice(0, -4) || '/';
    }
    if (u.pathname === '/' || u.pathname === '') {
        return u.origin;
    }
    return `${u.origin}${u.pathname}`;
}

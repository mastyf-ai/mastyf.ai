/** Inject rotated MCP session token into JSON-RPC tool result _meta. */
export function injectRotatedSessionIntoResult(msg, rotatedToken) {
    if (!rotatedToken || !msg.result || typeof msg.result !== 'object')
        return;
    const result = msg.result;
    const meta = result._meta ?? {};
    meta.sessionToken = rotatedToken;
    result._meta = meta;
}
//# sourceMappingURL=mcp-session-meta.js.map
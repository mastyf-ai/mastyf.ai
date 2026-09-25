function headerOne(headers, name) {
    if (!headers)
        return undefined;
    const v = headers[name];
    if (!v)
        return undefined;
    const s = Array.isArray(v) ? v[0] : v;
    return s?.trim() || undefined;
}
function metaSessionId(meta) {
    if (!meta)
        return undefined;
    const direct = meta.sessionId ?? meta.globalSessionId;
    if (typeof direct === 'string' && direct.trim())
        return direct.trim();
    const mastyfAi = meta.mastyfAi;
    if (mastyfAi && typeof mastyfAi.sessionId === 'string' && mastyfAi.sessionId.trim()) {
        return mastyfAi.sessionId.trim();
    }
    return undefined;
}
/** Stable key spanning tool calls and MCP servers for fleet chain graphs. */
export function resolveGlobalSessionId(input) {
    const fromHeader = headerOne(input.headers, 'x-mastyf-ai-global-session')
        ?? headerOne(input.headers, 'x-mcp-session-id');
    if (fromHeader)
        return fromHeader;
    const fromMeta = metaSessionId(input.meta);
    if (fromMeta)
        return fromMeta;
    if (input.agentId && input.mcpSessionId) {
        return `agent:${input.agentId}:mcp:${input.mcpSessionId}`;
    }
    if (input.agentId)
        return `agent:${input.agentId}`;
    if (input.mcpSessionId)
        return `mcp:${input.mcpSessionId}`;
    return `req:${input.requestId}`;
}
export function fleetChainBlockConfidenceThreshold() {
    const raw = process.env.MASTYF_AI_FLEET_CHAIN_BLOCK_CONFIDENCE ?? '0.65';
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.65;
}
/** Per-request fallback ids cannot correlate cross-server chains. */
export function isEphemeralRequestSession(globalSessionId) {
    return globalSessionId.startsWith('req:');
}
/** Derive agent id for fleet chain events when JWT sub is absent. */
export function deriveAgentIdForFleetChain(globalSessionId, agentId) {
    if (agentId?.trim())
        return agentId.trim();
    if (globalSessionId.startsWith('agent:')) {
        const rest = globalSessionId.slice('agent:'.length);
        const mcpIdx = rest.indexOf(':mcp:');
        return mcpIdx >= 0 ? rest.slice(0, mcpIdx) : rest;
    }
    if (globalSessionId.startsWith('mcp:'))
        return globalSessionId.slice('mcp:'.length);
    return globalSessionId;
}
//# sourceMappingURL=global-session-id.js.map
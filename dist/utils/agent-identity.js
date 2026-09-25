/**
 * Stable agent + session identity for reputation, chain detection, and sandbox tiers.
 */
import { createHash } from 'crypto';
function hashId(input) {
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
/** Resolve agent/session from MCP _meta, OAuth claims, or fallbacks. */
export function resolveAgentContext(params) {
    const meta = params.meta ?? {};
    const auth = meta.auth;
    const mastyfAi = meta['mastyf-ai'];
    const userId = mastyfAi?.userId
        ?? auth?.sub
        ?? params.authSub;
    const clientId = mastyfAi?.clientId
        ?? meta.clientId
        ?? 'mcp-client';
    const sessionId = mastyfAi?.sessionId
        ?? meta.sessionId
        ?? params.fallbackSessionKey
        ?? hashId(`${params.serverName}:${clientId}:${Date.now()}`);
    const agentId = mastyfAi?.agentId
        ?? meta.agentId
        ?? (userId ? hashId(`agent:${userId}:${clientId}`) : hashId(`agent:${clientId}:${params.serverName}`));
    return { agentId, sessionId, userId, clientId };
}
//# sourceMappingURL=agent-identity.js.map
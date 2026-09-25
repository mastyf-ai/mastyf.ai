export interface AgentContext {
    agentId: string;
    sessionId: string;
    userId?: string;
    clientId?: string;
}
/** Resolve agent/session from MCP _meta, OAuth claims, or fallbacks. */
export declare function resolveAgentContext(params: {
    meta?: Record<string, unknown>;
    authSub?: string;
    authTenant?: string;
    serverName: string;
    fallbackSessionKey?: string;
}): AgentContext;
//# sourceMappingURL=agent-identity.d.ts.map
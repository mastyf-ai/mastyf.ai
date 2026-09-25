export type McpMethod = 'initialize' | 'initialized' | 'ping' | 'tools/list' | 'tools/call' | 'resources/list' | 'resources/read' | 'resources/templates/list' | 'prompts/list' | 'prompts/get' | 'logging/setLevel' | 'notifications/initialized' | 'notifications/cancelled';
export interface LifecyclePolicy {
    /** MCP methods allowed for unauthenticated connections */
    unauthenticatedMethods: McpMethod[];
    /** Per-method permission tiers */
    methodTiers: Record<McpMethod, 'open' | 'readonly' | 'standard' | 'admin'>;
    /** Whether to audit every lifecycle event */
    auditAll: boolean;
    /** Maximum concurrent sessions */
    maxSessions: number;
    /** Session timeout in ms */
    sessionTimeoutMs: number;
}
export interface McpSession {
    sessionId: string;
    clientId: string;
    connectedAt: string;
    lastActivity: string;
    initialized: boolean;
    protocolVersion?: string;
    serverInfo?: {
        name: string;
        version: string;
    };
    capabilities?: Record<string, unknown>;
    authenticated: boolean;
    authenticatedUserId?: string;
    requestCount: number;
    blockedCount: number;
}
export interface LifecycleEvent {
    timestamp: string;
    sessionId: string;
    method: McpMethod;
    action: 'allowed' | 'blocked' | 'initialized' | 'terminated';
    details: string;
    toolName?: string;
    argsSummary?: string;
    latencyMs?: number;
    userId?: string;
}
export declare class McpLifecycleGuard {
    private sessions;
    private events;
    private policy;
    private totalRequests;
    private totalBlocked;
    constructor(policy?: Partial<LifecyclePolicy>);
    /** Register a new MCP session (on initialize). */
    registerSession(clientId: string, protocolVersion?: string): McpSession;
    /** Mark a session as initialized (post-handshake). */
    markInitialized(sessionId: string, serverInfo?: {
        name: string;
        version: string;
    }, capabilities?: Record<string, unknown>): boolean;
    /** Check if a method is allowed for the given session state. */
    checkAccess(sessionId: string, method: McpMethod, authenticated: boolean, userTier?: 'open' | 'readonly' | 'standard' | 'admin'): {
        allowed: boolean;
        reason?: string;
    };
    /** Record an MCP request through the lifecycle guard. */
    recordRequest(sessionId: string, method: McpMethod, blocked: boolean, toolName?: string, argsSummary?: string, latencyMs?: number, userId?: string): void;
    /** Terminate a session. */
    terminateSession(sessionId: string, reason: string): boolean;
    /** Get lifecycle audit events. */
    getEvents(limit?: number): LifecycleEvent[];
    /** Get active sessions. */
    getActiveSessions(): McpSession[];
    /** Get lifecycle statistics. */
    getStats(): {
        activeSessions: number;
        totalRequests: number;
        totalBlocked: number;
        totalEvents: number;
    };
    private recordEvent;
}
//# sourceMappingURL=lifecycle-guard.d.ts.map
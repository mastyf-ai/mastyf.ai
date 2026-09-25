/**
 * MCP Lifecycle Guard — intercepts MCP protocol messages at the proxy layer
 * to enforce per-method policies and provide protocol-level audit.
 *
 * Features:
 *   - Allow `initialize` without authentication (configurable)
 *   - Enforce different policies per MCP method type
 *   - Track MCP protocol state per session
 *   - Full lifecycle audit trail
 */
import { Logger } from '../../utils/logger.js';
const DEFAULT_POLICY = {
    unauthenticatedMethods: ['initialize', 'ping'],
    methodTiers: {
        'initialize': 'open',
        'initialized': 'open',
        'ping': 'open',
        'tools/list': 'readonly',
        'tools/call': 'standard',
        'resources/list': 'readonly',
        'resources/read': 'standard',
        'resources/templates/list': 'readonly',
        'prompts/list': 'readonly',
        'prompts/get': 'standard',
        'logging/setLevel': 'admin',
        'notifications/initialized': 'open',
        'notifications/cancelled': 'open',
    },
    auditAll: true,
    maxSessions: 1000,
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
};
export class McpLifecycleGuard {
    sessions = new Map();
    events = [];
    policy;
    totalRequests = 0;
    totalBlocked = 0;
    constructor(policy) {
        this.policy = { ...DEFAULT_POLICY, ...policy };
    }
    /** Register a new MCP session (on initialize). */
    registerSession(clientId, protocolVersion) {
        // Enforce max sessions
        if (this.sessions.size >= this.policy.maxSessions) {
            const oldest = [...this.sessions.values()]
                .sort((a, b) => new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime())[0];
            if (oldest) {
                this.terminateSession(oldest.sessionId, 'max_sessions_exceeded');
            }
        }
        const session = {
            sessionId: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            clientId,
            connectedAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            initialized: false,
            protocolVersion,
            authenticated: false,
            requestCount: 0,
            blockedCount: 0,
        };
        this.sessions.set(session.sessionId, session);
        Logger.info(`[LifecycleGuard] New session: ${session.sessionId} (client: ${clientId})`);
        return session;
    }
    /** Mark a session as initialized (post-handshake). */
    markInitialized(sessionId, serverInfo, capabilities) {
        const s = this.sessions.get(sessionId);
        if (!s)
            return false;
        s.initialized = true;
        s.serverInfo = serverInfo;
        s.capabilities = capabilities;
        s.lastActivity = new Date().toISOString();
        this.recordEvent(sessionId, 'initialize', 'initialized', `Protocol v${s.protocolVersion || 'unknown'}, server: ${serverInfo?.name || 'unknown'}`);
        return true;
    }
    /** Check if a method is allowed for the given session state. */
    checkAccess(sessionId, method, authenticated, userTier = 'standard') {
        const s = this.sessions.get(sessionId);
        if (!s) {
            // Allow initialize without a session
            if (method === 'initialize')
                return { allowed: true };
            return { allowed: false, reason: `No active session — initialize first` };
        }
        // Check session timeout
        const lastActivity = new Date(s.lastActivity).getTime();
        if (Date.now() - lastActivity > this.policy.sessionTimeoutMs) {
            this.terminateSession(sessionId, 'session_timeout');
            return { allowed: false, reason: 'Session timed out' };
        }
        // Allow unauthenticated methods without auth check
        if (!authenticated && this.policy.unauthenticatedMethods.includes(method)) {
            s.lastActivity = new Date().toISOString();
            return { allowed: true };
        }
        // If not authenticated and method requires auth
        if (!authenticated && !this.policy.unauthenticatedMethods.includes(method)) {
            return { allowed: false, reason: `Authentication required for ${method}` };
        }
        // Check method tier
        const requiredTier = this.policy.methodTiers[method] || 'standard';
        const tierLevels = { open: 0, readonly: 1, standard: 2, admin: 3 };
        if (tierLevels[userTier] < tierLevels[requiredTier]) {
            return { allowed: false, reason: `Method ${method} requires ${requiredTier} tier, user has ${userTier}` };
        }
        s.lastActivity = new Date().toISOString();
        return { allowed: true };
    }
    /** Record an MCP request through the lifecycle guard. */
    recordRequest(sessionId, method, blocked, toolName, argsSummary, latencyMs, userId) {
        this.totalRequests++;
        const s = this.sessions.get(sessionId);
        if (s) {
            s.requestCount++;
            if (blocked) {
                s.blockedCount++;
                this.totalBlocked++;
            }
        }
        if (this.policy.auditAll) {
            this.recordEvent(sessionId, method, blocked ? 'blocked' : 'allowed', `${method} ${toolName ? `(${toolName})` : ''} ${blocked ? 'BLOCKED' : 'allowed'} ${argsSummary ? `args: ${argsSummary.slice(0, 100)}` : ''}`, toolName, argsSummary, latencyMs, userId);
        }
        // Trim events to prevent unbounded growth
        if (this.events.length > 10000) {
            this.events = this.events.slice(-5000);
        }
    }
    /** Terminate a session. */
    terminateSession(sessionId, reason) {
        const s = this.sessions.get(sessionId);
        if (!s)
            return false;
        this.recordEvent(sessionId, 'notifications/cancelled', 'terminated', reason);
        this.sessions.delete(sessionId);
        Logger.info(`[LifecycleGuard] Terminated session ${sessionId}: ${reason}`);
        return true;
    }
    /** Get lifecycle audit events. */
    getEvents(limit = 100) {
        return this.events.slice(-limit).reverse();
    }
    /** Get active sessions. */
    getActiveSessions() {
        return [...this.sessions.values()];
    }
    /** Get lifecycle statistics. */
    getStats() {
        return {
            activeSessions: this.sessions.size,
            totalRequests: this.totalRequests,
            totalBlocked: this.totalBlocked,
            totalEvents: this.events.length,
        };
    }
    recordEvent(sessionId, method, action, details, toolName, argsSummary, latencyMs, userId) {
        this.events.push({
            timestamp: new Date().toISOString(),
            sessionId,
            method,
            action,
            details,
            toolName,
            argsSummary,
            latencyMs,
            userId,
        });
    }
}
//# sourceMappingURL=lifecycle-guard.js.map
/**
 * MCP session-scoped auth headers (stdio sticky OAuth).
 */
export class ProxySessionAuthStore {
    bySession = new Map();
    setForSession(sessionId, authHeader) {
        if (!sessionId || !authHeader)
            return;
        this.bySession.set(sessionId, { authHeader, updatedAt: Date.now() });
    }
    onSessionChange(previousSessionId, newSessionId) {
        if (previousSessionId && previousSessionId !== newSessionId) {
            this.bySession.delete(previousSessionId);
        }
    }
    getAuthHeader(sessionId, perMessageAuth, stickyEnabled) {
        if (perMessageAuth)
            return perMessageAuth;
        if (!stickyEnabled || !sessionId)
            return undefined;
        return this.bySession.get(sessionId)?.authHeader;
    }
    hasSessionAuth(sessionId) {
        if (!sessionId)
            return false;
        return this.bySession.has(sessionId);
    }
    clearAll() {
        this.bySession.clear();
    }
    clearExcept(sessionId) {
        if (!sessionId) {
            this.clearAll();
            return;
        }
        for (const key of [...this.bySession.keys()]) {
            if (key !== sessionId)
                this.bySession.delete(key);
        }
    }
}
//# sourceMappingURL=proxy-session-auth.js.map
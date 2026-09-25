/**
 * MCP session-scoped auth headers (stdio sticky OAuth).
 */
export declare class ProxySessionAuthStore {
    private readonly bySession;
    setForSession(sessionId: string, authHeader: string): void;
    onSessionChange(previousSessionId: string | null, newSessionId: string): void;
    getAuthHeader(sessionId: string | null | undefined, perMessageAuth: string | undefined, stickyEnabled: boolean): string | undefined;
    hasSessionAuth(sessionId: string | null | undefined): boolean;
    clearAll(): void;
    clearExcept(sessionId: string | null | undefined): void;
}
//# sourceMappingURL=proxy-session-auth.d.ts.map
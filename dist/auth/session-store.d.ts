import type { AuthSession } from './rbac-types.js';
export interface CreatedSession {
    sessionId: string;
    token: string;
    csrfSecret: string;
    expiresAt: string;
}
export declare const sessionStore: {
    create(params: {
        userId: string;
        tenantId?: string;
        ipAddress?: string | null;
        userAgent?: string | null;
        ttlMinutes: number;
    }): Promise<CreatedSession>;
    /** Validate a raw cookie token; returns the session row (with sliding-window touch) or null. */
    validate(token: string): Promise<(AuthSession & {
        csrfSecret: string;
        userId: string;
    }) | null>;
    revoke(sessionId: string): Promise<void>;
    revokeByToken(token: string): Promise<void>;
    revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void>;
    listForUser(userId: string, currentSessionId?: string): Promise<AuthSession[]>;
    findById(sessionId: string): Promise<AuthSession | null>;
};
//# sourceMappingURL=session-store.d.ts.map
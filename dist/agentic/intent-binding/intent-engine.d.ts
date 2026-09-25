/**
 * Intent binding engine — session-scoped declared intent and tool allowlists.
 */
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface DeclaredIntent {
    sessionId: string;
    agentId?: string;
    intent: string;
    allowedTools: string[];
    expiresAt: string;
}
export declare class IntentEngine {
    private readonly store?;
    private bindings;
    constructor(store?: IndustryStandardStore | undefined);
    declareIntent(sessionId: string, intent: string, allowedTools: string[], opts?: {
        agentId?: string;
        ttlMs?: number;
    }): DeclaredIntent;
    getIntent(sessionId: string): DeclaredIntent | null;
    isCallAllowed(sessionId: string, toolName: string): {
        allowed: boolean;
        reason?: string;
    };
}
//# sourceMappingURL=intent-engine.d.ts.map
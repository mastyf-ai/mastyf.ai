import type { CallContext, PolicyDecision } from '../policy/policy-types.js';
export interface SemanticAuditJob {
    requestId: string | number;
    serverName: string;
    toolName: string;
    arguments?: Record<string, unknown>;
    syncDecision: PolicyDecision;
    timestamp: string;
    tenantId?: string;
    /** @internal set when Redis cluster slot was acquired at enqueue */
    redisSlotHeld?: boolean;
}
export interface SemanticAuditResult {
    suspicious: boolean;
    confidence: number;
    categories: string[];
    reasoning: string;
}
export interface SemanticAuditStats {
    queued: number;
    processed: number;
    flagged: number;
    dropped: number;
    enabled: boolean;
}
export declare function isSemanticAsyncEnabled(tenantId?: string): boolean;
/** @internal test helper */
export declare function resetSemanticAuditStateForTests(): void;
export declare function getSemanticAuditStats(): SemanticAuditStats;
/** Wait for debounced async semantic queue (used by swarm live scenario before proxy exit). */
export declare function flushSemanticAuditQueue(maxWaitMs?: number): Promise<SemanticAuditStats>;
/** Enqueue async semantic audit (debounced batch drain). Never blocks the caller. */
export declare function enqueueSemanticAudit(job: SemanticAuditJob): void;
/** Build job from proxy context after sync policy evaluation. */
export declare function buildSemanticAuditJob(ctx: CallContext, syncDecision: PolicyDecision): SemanticAuditJob;
//# sourceMappingURL=async-semantic-audit.d.ts.map
import { type AttackPatternSuggestion } from './attack-pattern-learner.js';
export interface InstantBlockEvent {
    serverName: string;
    toolName: string;
    block_rule: string;
    block_reason: string;
    argsFingerprint: string;
    argSnippets?: string[];
    arguments?: Record<string, unknown>;
    tenantId?: string;
}
interface RecentBlock {
    ts: number;
    serverName: string;
    toolName: string;
    blockRule: string;
    blockReason: string;
    argsFingerprint: string;
    argSnippets?: string[];
    arguments?: Record<string, unknown>;
}
interface RuleToolStats {
    count: number;
    lastAt: string;
    reasons: string[];
}
export interface AttackLearningState {
    version: 1;
    updatedAt: string;
    totalEvents: number;
    ruleToolCounts: Record<string, RuleToolStats>;
    reasonNgrams: Record<string, number>;
    recentBlocks: RecentBlock[];
    queuedSuggestionKeys: string[];
    knownClassConfidence: Record<string, number>;
}
/** PostgreSQL-backed store (AuditTrailSync); falls back to local JSON file when unset. */
declare let sharedStore: {
    getAttackLearningState?: (tenantId: string) => Promise<AttackLearningState | null>;
    persistAttackLearningState?: (state: AttackLearningState, tenantId: string) => Promise<void>;
} | null;
export declare function setAttackLearningSharedStore(store: typeof sharedStore): void;
export declare function loadAttackLearningState(tenantId?: string): AttackLearningState;
/** Load from PostgreSQL shared store (call at bootstrap when MASTYF_AI_AUDIT_SYNC_ENABLED). */
export declare function loadAttackLearningFromSharedStore(tenantId?: string): Promise<void>;
export declare function saveAttackLearningState(state: AttackLearningState, tenantId?: string): void;
/** Extract 2–3 word n-grams from block reasons for rolling pattern stats. */
export declare function extractReasonNgrams(reason: string): string[];
export declare function queuePendingAttackSuggestion(suggestion: AttackPatternSuggestion, opts?: {
    confidenceBoost?: number;
    tenantId?: string;
    source?: string;
}): boolean;
/**
 * Synchronous per-block learning: rolling stats, state file, optional instant suggestion queue.
 */
export declare function recordInstantBlockEvent(event: InstantBlockEvent): {
    queued: boolean;
    windowCount: number;
};
/** @internal Test reset */
export declare function resetInstantAttackLearningState(): void;
export {};
//# sourceMappingURL=instant-attack-learning.d.ts.map
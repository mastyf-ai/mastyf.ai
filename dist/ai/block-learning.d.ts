import type { PolicyDecisionRecord } from './data-collector.js';
import type { HistoryDatabase } from '../database/history-db.js';
import type { McpServerConfig } from '../types.js';
export interface PolicyBlockContext {
    block_rule: string;
    toolName: string;
    serverName: string;
    argsFingerprint: string;
}
export interface BlockLearningEvent extends PolicyBlockContext {
    block_reason: string;
    argSnippets?: string[];
    /** Redacted tool arguments for LLM threat research (no secrets). */
    arguments?: Record<string, unknown>;
    tenantId?: string;
}
/** Stable 16-char hex fingerprint of normalized tool arguments. */
export declare function fingerprintArgs(args: unknown): string;
/** Redacted string snippets from tool args for instant learning (no secrets). */
export declare function redactArgSnippets(args: unknown, max?: number): string[];
/** Redacted tool arguments object for LLM threat research (no secrets). */
export declare function redactArguments(args: unknown, maxStringLen?: number): Record<string, unknown> | undefined;
/**
 * Per-block hook: immediate rolling stats + optional suggestion queue, then debounced full cycle.
 */
export declare function recordBlockLearningEvent(event: BlockLearningEvent, opts?: {
    db?: HistoryDatabase;
    servers?: McpServerConfig[];
}): void;
/**
 * Debounced hook after proxy blocks — batches burst blocks into one learning cycle.
 */
export declare function onPolicyBlock(context: PolicyBlockContext, opts?: {
    db?: HistoryDatabase;
    servers?: McpServerConfig[];
}): void;
/** Wire proxy policy evaluation into the in-memory collector. */
export declare function ingestPolicyDecision(decision: PolicyDecisionRecord): void;
/** Test helper — cancel pending debounce. */
export declare function resetBlockLearningDebounce(): void;
//# sourceMappingURL=block-learning.d.ts.map
/**
 * Swarm Debate Tribunal — multi-agent resolution for uncertain semantic audit records.
 */
import type { StoredSemanticAudit } from './semantic-audit-store.js';
export type DebatePersona = 'block_advocate' | 'allow_advocate' | 'auditor';
export type DebateArgument = {
    persona: DebatePersona;
    stance: 'block' | 'allow' | 'neutral';
    reasoning: string;
    confidence: number;
    citedFields: string[];
};
export type TribunalVerdict = {
    recommendedLabel: 'true_positive' | 'false_positive' | 'needs_review';
    unanimous: boolean;
    confidence: number;
    dissent?: string;
};
export type TribunalDebate = {
    recordId: string;
    toolName: string;
    serverName: string;
    uncertaintyScore: number;
    arguments: DebateArgument[];
    verdict: TribunalVerdict;
    transcript: string;
    generatedAt: string;
    autoLabelEligible: boolean;
};
export declare function applyTribunalAutoLabels(debates: TribunalDebate[], opts?: {
    userId?: string;
    tenantId?: string;
}): Promise<number>;
export declare function runTribunalDebate(rec: StoredSemanticAudit, opts?: {
    useLlm?: boolean;
}): Promise<TribunalDebate>;
export declare const DEFAULT_TRIBUNAL_BATCH = 10;
export declare function peekTribunalQueue(opts?: {
    tenantId?: string;
    limit?: number;
    uncertaintyMin?: number;
}): Promise<{
    batchLimit: number;
    eligibleTotal: number;
    nextBatchSize: number;
    remainingEligible: number;
    pendingTribunalCount: number;
}>;
export declare function runTribunalForQueue(opts?: {
    tenantId?: string;
    limit?: number;
    uncertaintyMin?: number;
    useLlm?: boolean;
}): Promise<{
    debates: TribunalDebate[];
    queueSize: number;
    batchLimit: number;
    eligibleTotal: number;
    remainingEligible: number;
}>;
export type TribunalReport = {
    generatedAt: string;
    queueSize: number;
    debatedCount: number;
    batchLimit: number;
    eligibleTotal: number;
    remainingEligible: number;
    debates: TribunalDebate[];
    quorumMet: boolean;
    autoLabelsApplied: number;
};
export declare function buildTribunalReport(opts?: {
    tenantId?: string;
    limit?: number;
    useLlm?: boolean;
}): Promise<TribunalReport>;
//# sourceMappingURL=swarm-debate-tribunal.d.ts.map
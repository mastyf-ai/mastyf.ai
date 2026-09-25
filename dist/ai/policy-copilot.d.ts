import type { PolicyRule } from '../policy/policy-types.js';
export type ReplaySampleResult = {
    id: string;
    source: 'corpus' | 'history';
    toolName: string;
    expected: 'block' | 'pass' | 'unknown';
    actual: 'block' | 'flag' | 'pass';
    rule?: string;
    matchedDraft: boolean;
    ok: boolean;
};
export type PolicyCopilotReplayMatrix = {
    total: number;
    passed: number;
    failed: number;
    results: ReplaySampleResult[];
    readyForReview: boolean;
    blockReason?: string;
};
export type PolicyCopilotSuggestion = {
    goal: string;
    rule: PolicyRule;
    yaml: string;
    confidence: number;
    reason: string;
    validationErrors: string[];
    replay: PolicyCopilotReplayMatrix;
    staged: boolean;
};
export declare function replayDraftRule(draftRule: PolicyRule, opts?: {
    policyPath?: string;
    corpusLimit?: number;
    historyLimit?: number;
    tenantId?: string;
}): PolicyCopilotReplayMatrix;
export declare function replayDraftRuleAsync(draftRule: PolicyRule, opts?: {
    policyPath?: string;
    corpusLimit?: number;
    historyLimit?: number;
    tenantId?: string;
}): Promise<PolicyCopilotReplayMatrix>;
export declare function generatePolicyCopilotSuggestion(goal: string, opts?: {
    availableTools?: string[];
    policyPath?: string;
    tenantId?: string;
    skipReplay?: boolean;
}): Promise<PolicyCopilotSuggestion | null>;
//# sourceMappingURL=policy-copilot.d.ts.map
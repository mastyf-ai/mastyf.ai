/**
 * In-memory + DB store for policy draft approvals (C5 human-in-the-loop).
 */
import type { PolicyRule } from '../../policy/policy-types.js';
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface PolicyDraftApproval {
    requestId: string;
    goal: string;
    rule: PolicyRule;
    yaml: string;
    status: 'pending' | 'approved' | 'denied' | 'applied';
    createdAt: string;
}
export declare function bindPolicyApprovalStore(store: IndustryStandardStore): void;
export declare function storePolicyDraft(params: {
    requestId: string;
    goal: string;
    rule: PolicyRule;
    yaml: string;
}): PolicyDraftApproval;
export declare function getPolicyDraft(requestId: string): PolicyDraftApproval | undefined;
export declare function markPolicyDraftApproved(requestId: string): boolean;
export declare function markPolicyDraftDenied(requestId: string): boolean;
export declare function markPolicyDraftApplied(requestId: string): boolean;
export declare function clearPolicyDraftsForTests(): void;
//# sourceMappingURL=policy-approval-store.d.ts.map
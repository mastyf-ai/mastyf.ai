export interface CostBudgetSettings {
    /** Monthly budget in USD, or null when none is set. */
    monthlyUsd: number | null;
    /** Alert when spend reaches this share of the budget (1–100). */
    alertAtPct: number;
    /** Where the budget came from: saved in the dashboard, or the MASTYF_AI_COST_BUDGET_USD variable. */
    source: 'dashboard' | 'env' | null;
    updatedAt: string | null;
    updatedBy: string | null;
}
export declare function readCostBudget(tenantId: string): CostBudgetSettings;
/** Save a budget, or clear it with monthlyUsd: null. */
export declare function writeCostBudget(tenantId: string, input: {
    monthlyUsd: number | null;
    alertAtPct?: number;
}, updatedBy: string | null): CostBudgetSettings;
/** The monthly budget pro-rated to a reporting window (30-day month). */
export declare function budgetForWindow(monthlyUsd: number | null, windowDays: number): number | null;
export interface PolicyVersion {
    id: string;
    savedAt: string;
    savedBy: string | null;
    sha256: string;
    bytes: number;
    ruleCount: number | null;
    mode: string | null;
    /** "save" from the editor, "rule-change" (a rule switched on/off or deleted), "restore" of an earlier version, or "before-first-save" (the file as it was). */
    reason: 'save' | 'rule-change' | 'restore' | 'before-first-save';
}
/** Store a version. Skips it when it is identical to the newest stored version. */
export declare function recordPolicyVersion(tenantId: string, yaml: string, savedBy: string | null, reason: PolicyVersion['reason']): PolicyVersion | null;
/** Newest first. */
export declare function listPolicyVersions(tenantId: string, limit?: number): PolicyVersion[];
export declare function readPolicyVersion(tenantId: string, id: string): {
    meta: PolicyVersion;
    yaml: string;
} | null;
/**
 * Record a policy edit made outside the editor (switching a rule on or off, deleting a rule):
 * keeps the file as it was if history is empty, then the new version. Never throws.
 */
export declare function recordPolicyEdit(tenantId: string, beforeYaml: string, afterYaml: string, savedBy: string | null): string | null;
//# sourceMappingURL=dashboard-settings-store.d.ts.map
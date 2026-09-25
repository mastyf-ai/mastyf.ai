/** Shared shapes for dashboard APIs — no synthetic metrics when live data is missing. */
export function unavailable(partial, error) {
    return { ...partial, available: false, error };
}
export function available(data) {
    return { ...data, available: true };
}
export function isDemoThreatId(id) {
    return /TEST\d/i.test(id) || id.startsWith('CVE-2026-TEST');
}
export function defaultPolicyPath() {
    return (process.env.MASTYF_AI_POLICY_PATH
        || process.env.MASTYF_AI_POLICY_PATH
        || 'default-policy.yaml');
}
export function parseCostBudgetUsd() {
    const raw = process.env.MASTYF_AI_COST_BUDGET_USD;
    if (!raw)
        return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}
//# sourceMappingURL=dashboard-live-data.js.map
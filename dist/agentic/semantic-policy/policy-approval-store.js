const drafts = new Map();
let backingStore;
export function bindPolicyApprovalStore(store) {
    backingStore = store;
    for (const row of store.listPolicyDraftApprovals(500)) {
        if (drafts.has(row.requestId))
            continue;
        drafts.set(row.requestId, {
            requestId: row.requestId,
            goal: row.goal,
            rule: JSON.parse(row.ruleJson),
            yaml: row.yaml,
            status: row.status,
            createdAt: row.createdAt,
        });
    }
}
function persist(d) {
    backingStore?.savePolicyDraftApproval({
        requestId: d.requestId,
        goal: d.goal,
        ruleJson: JSON.stringify(d.rule),
        yaml: d.yaml,
        status: d.status,
        createdAt: d.createdAt,
    });
}
export function storePolicyDraft(params) {
    const entry = {
        ...params,
        status: 'pending',
        createdAt: new Date().toISOString(),
    };
    drafts.set(params.requestId, entry);
    persist(entry);
    return entry;
}
export function getPolicyDraft(requestId) {
    const cached = drafts.get(requestId);
    if (cached)
        return cached;
    const row = backingStore?.getPolicyDraftApproval(requestId);
    if (!row)
        return undefined;
    const entry = {
        requestId: row.requestId,
        goal: row.goal,
        rule: JSON.parse(row.ruleJson),
        yaml: row.yaml,
        status: row.status,
        createdAt: row.createdAt,
    };
    drafts.set(requestId, entry);
    return entry;
}
export function markPolicyDraftApproved(requestId) {
    const d = getPolicyDraft(requestId);
    if (!d || d.status !== 'pending')
        return false;
    d.status = 'approved';
    persist(d);
    return true;
}
export function markPolicyDraftDenied(requestId) {
    const d = getPolicyDraft(requestId);
    if (!d || d.status !== 'pending')
        return false;
    d.status = 'denied';
    persist(d);
    return true;
}
export function markPolicyDraftApplied(requestId) {
    const d = getPolicyDraft(requestId);
    if (!d || d.status !== 'approved')
        return false;
    d.status = 'applied';
    persist(d);
    return true;
}
export function clearPolicyDraftsForTests() {
    drafts.clear();
}
//# sourceMappingURL=policy-approval-store.js.map
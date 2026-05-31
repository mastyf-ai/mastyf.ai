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

const drafts = new Map<string, PolicyDraftApproval>();
let backingStore: IndustryStandardStore | undefined;

export function bindPolicyApprovalStore(store: IndustryStandardStore): void {
  backingStore = store;
  for (const row of store.listPolicyDraftApprovals(500)) {
    if (drafts.has(row.requestId)) continue;
    drafts.set(row.requestId, {
      requestId: row.requestId,
      goal: row.goal,
      rule: JSON.parse(row.ruleJson) as PolicyRule,
      yaml: row.yaml,
      status: row.status as PolicyDraftApproval['status'],
      createdAt: row.createdAt,
    });
  }
}

function persist(d: PolicyDraftApproval): void {
  backingStore?.savePolicyDraftApproval({
    requestId: d.requestId,
    goal: d.goal,
    ruleJson: JSON.stringify(d.rule),
    yaml: d.yaml,
    status: d.status,
    createdAt: d.createdAt,
  });
}

export function storePolicyDraft(params: {
  requestId: string;
  goal: string;
  rule: PolicyRule;
  yaml: string;
}): PolicyDraftApproval {
  const entry: PolicyDraftApproval = {
    ...params,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  drafts.set(params.requestId, entry);
  persist(entry);
  return entry;
}

export function getPolicyDraft(requestId: string): PolicyDraftApproval | undefined {
  const cached = drafts.get(requestId);
  if (cached) return cached;
  const row = backingStore?.getPolicyDraftApproval(requestId);
  if (!row) return undefined;
  const entry: PolicyDraftApproval = {
    requestId: row.requestId,
    goal: row.goal,
    rule: JSON.parse(row.ruleJson) as PolicyRule,
    yaml: row.yaml,
    status: row.status as PolicyDraftApproval['status'],
    createdAt: row.createdAt,
  };
  drafts.set(requestId, entry);
  return entry;
}

export function markPolicyDraftApproved(requestId: string): boolean {
  const d = getPolicyDraft(requestId);
  if (!d || d.status !== 'pending') return false;
  d.status = 'approved';
  persist(d);
  return true;
}

export function markPolicyDraftDenied(requestId: string): boolean {
  const d = getPolicyDraft(requestId);
  if (!d || d.status !== 'pending') return false;
  d.status = 'denied';
  persist(d);
  return true;
}

export function markPolicyDraftApplied(requestId: string): boolean {
  const d = getPolicyDraft(requestId);
  if (!d || d.status !== 'approved') return false;
  d.status = 'applied';
  persist(d);
  return true;
}

export function clearPolicyDraftsForTests(): void {
  drafts.clear();
}

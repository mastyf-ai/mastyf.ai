'use client';

import { useState } from 'react';
import { Card } from '../ui/Card';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    try {
      const parsed = JSON.parse(text) as { validationErrors?: string[]; error?: string };
      if (parsed.validationErrors?.length) {
        throw new Error(`Policy rejected: ${parsed.validationErrors.join('; ')}`);
      }
      throw new Error(parsed.error ?? text);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Policy rejected')) throw e;
      throw new Error(text || res.statusText);
    }
  }
  return JSON.parse(text) as T;
}

type DraftResult = {
  goal: string;
  yaml: string;
  rule: { name: string; action?: string };
  staged: boolean;
  replay: { passed: number; total: number; blockReason?: string; readyForReview?: boolean };
};

type ExplainResult = {
  overview: string;
  sections: Array<{ title: string; summary: string }>;
  ruleCount: number;
  mode: string;
};

type ApprovalEntry = {
  requestId: string;
  status: 'pending' | 'approved' | 'denied' | 'applied';
};

type TranslateResult = {
  direction: string;
  draft?: DraftResult;
  summary?: ExplainResult;
  rejected?: boolean;
  validationErrors?: string[];
};

type SimulateResult = {
  allowed?: boolean;
  summary?: string;
  counterfactual?: { wouldBlock?: number; wouldAllow?: number };
};

export function SemanticPolicyPanel() {
  const [goal, setGoal] = useState('Block curl and wget in all tool arguments');
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const [approval, setApproval] = useState<ApprovalEntry | null>(null);
  const [simulate, setSimulate] = useState<SimulateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function handleDraft() {
    setLoading(true);
    setError(null);
    setApproval(null);
    setSimulate(null);
    setStatusMsg(null);
    try {
      const translated = await postJson<TranslateResult>('/api/agentic/policy/translate', {
        direction: 'nl-to-yaml',
        goal,
      });
      if (translated.rejected || !translated.draft) {
        setError(translated.validationErrors?.join('; ') ?? 'Policy draft rejected as unsafe');
        setDraft(null);
        setExplain(null);
        return;
      }
      setDraft(translated.draft);
      const explained = await postJson<TranslateResult>('/api/agentic/policy/translate', {
        direction: 'yaml-to-nl',
        yaml: translated.draft.yaml,
      });
      setExplain(explained.summary ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSimulate() {
    if (!draft?.rule) return;
    setLoading(true);
    setError(null);
    try {
      const result = await postJson<SimulateResult>('/api/agentic/policy/simulate', { rule: draft.rule });
      setSimulate(result);
      setStatusMsg('Simulation complete — review counterfactual impact before approval.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitApproval() {
    if (!draft) return;
    setLoading(true);
    setError(null);
    try {
      const entry = await postJson<ApprovalEntry>('/api/agentic/policy/submit-approval', {
        goal: draft.goal,
        rule: draft.rule,
        yaml: draft.yaml,
      });
      setApproval(entry);
      setStatusMsg(`Submitted for approval (${entry.requestId.slice(0, 8)}…)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(approved: boolean) {
    if (!approval?.requestId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await postJson<{ ok: boolean; status: string }>('/api/agentic/policy/approve', {
        requestId: approval.requestId,
        approved,
      });
      if (result.ok) {
        setApproval({ ...approval, status: result.status as ApprovalEntry['status'] });
        setStatusMsg(approved ? 'Draft approved — ready to apply.' : 'Draft denied.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!approval?.requestId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await postJson<{ applied: boolean; reason?: string }>('/api/agentic/policy/apply-approved', {
        requestId: approval.requestId,
      });
      if (result.applied) {
        setApproval({ ...approval, status: 'applied' });
        setStatusMsg('Policy rule applied to live YAML.');
      } else {
        setError(result.reason ?? 'Apply failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">Semantic Policy Translator (C5)</h3>
      <p className="text-sm text-muted-foreground">
        Plain English → draft YAML → simulate → human approval → apply with provenance.
      </p>
      <textarea
        className="w-full min-h-[80px] rounded border border-border bg-background p-2 text-sm font-mono"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
          disabled={loading || !goal.trim()}
          onClick={() => void handleDraft()}
        >
          {loading ? 'Working…' : '1. Generate draft'}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          disabled={loading || !draft}
          onClick={() => void handleSimulate()}
        >
          2. Simulate
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          disabled={loading || !draft}
          onClick={() => void handleSubmitApproval()}
        >
          3. Submit approval
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          disabled={loading || approval?.status !== 'pending'}
          onClick={() => void handleApprove(true)}
        >
          Approve
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          disabled={loading || approval?.status !== 'pending'}
          onClick={() => void handleApprove(false)}
        >
          Deny
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded bg-green-700 text-white text-sm disabled:opacity-50"
          disabled={loading || approval?.status !== 'approved'}
          onClick={() => void handleApply()}
        >
          4. Apply approved
        </button>
      </div>
      {statusMsg && <p className="text-sm text-green-700 dark:text-green-400">{statusMsg}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {approval && (
        <p className="text-sm font-mono">
          Approval: {approval.requestId.slice(0, 8)}… · status: {approval.status}
        </p>
      )}
      {draft && (
        <div className="space-y-2">
          <p className="text-sm">
            Replay: {draft.replay.passed}/{draft.replay.total} · Staged: {draft.staged ? 'yes' : 'no'}
            {draft.replay.blockReason ? ` · ${draft.replay.blockReason}` : ''}
          </p>
          <pre className="text-xs overflow-x-auto p-2 rounded bg-muted">{draft.yaml}</pre>
        </div>
      )}
      {simulate && (
        <p className="text-sm text-muted-foreground">
          Simulation: {simulate.summary ?? JSON.stringify(simulate.counterfactual ?? simulate)}
        </p>
      )}
      {explain && (
        <div className="text-sm space-y-1">
          <p className="font-medium">Plain-English summary</p>
          <p>{explain.overview}</p>
          {explain.sections.slice(0, 5).map((s) => (
            <p key={s.title}>
              <span className="font-medium">{s.title}:</span> {s.summary}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

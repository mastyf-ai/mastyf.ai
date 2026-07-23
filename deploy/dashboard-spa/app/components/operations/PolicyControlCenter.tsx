'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchPolicy,
  fetchPolicyRules,
  savePolicy,
  reloadPolicy,
  togglePolicyRule,
  removePolicyRule,
  testPolicy,
  fetchPolicyCopilot,
  fetchPolicyCounterfactual,
  acceptSuggestion,
  rejectSuggestion,
  rejectFp,
  type ActivePolicyRule,
  type PolicyInfo,
} from '@/lib/mastyf-ai-api';
import { hasPermission } from '@/lib/dashboard-roles';
import { Card } from '@/app/components/ui/Card';
import { Button } from '@/app/components/ui/Button';
import { Badge } from '@/app/components/ui/Badge';
import { KpiCard } from '@/app/components/ui/KpiCard';
import { EmptyState } from '@/app/components/ui/EmptyState';
import { WorkspaceSubNav } from '@/app/components/ui/WorkspaceSubNav';
import EvalPlaygroundPanel from './EvalPlaygroundPanel';
import CorpusReviewPanel from './CorpusReviewPanel';

type PolicyView = 'rules' | 'editor' | 'test' | 'eval' | 'review' | 'history';

type Props = {
  view: PolicyView;
  onViewChange: (v: PolicyView) => void;
  roles?: string[];
  lastBlocked?: { tool_name: string; server_name: string; reason: string | null } | null;
  onAction?: (msg: string) => void;
  copilotInitialTab?: 'generate' | 'counterfactual';
};

const VIEW_LABELS: { id: PolicyView; label: string }[] = [
  { id: 'rules', label: 'Active Rules' },
  { id: 'editor', label: 'Policy Editor' },
  { id: 'test', label: 'Test & Simulate' },
  { id: 'eval', label: 'Policy Eval' },
  { id: 'review', label: 'Corpus Review' },
  { id: 'history', label: 'Version History' },
];

export function PolicyControlCenter({ view, onViewChange, roles, lastBlocked, onAction, copilotInitialTab }: Props) {
  const canTest = hasPermission(roles, 'policy_test');
  const canMutate = hasPermission(roles, 'policy_mutate');

  const [policy, setPolicy] = useState<PolicyInfo | null>(null);
  const [rules, setRules] = useState<ActivePolicyRule[]>([]);
  const [draftYaml, setDraftYaml] = useState('');
  const [saving, setSaving] = useState(false);
  const [ruleBusy, setRuleBusy] = useState<string | null>(null);
  const [ruleFilter, setRuleFilter] = useState('');
  const [selectedRules, setSelectedRules] = useState<Set<string>>(new Set());

  const [testTool, setTestTool] = useState('');
  const [testArgs, setTestArgs] = useState('{"query": "test"}');
  const [testResult, setTestResult] = useState('');
  const [testHistory, setTestHistory] = useState<string[]>([]);

  const [copilotGoal, setCopilotGoal] = useState('');
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotYaml, setCopilotYaml] = useState('');

  const refresh = useCallback(async () => {
    const [next, nextRules] = await Promise.all([fetchPolicy(), fetchPolicyRules()]);
    setPolicy(next);
    setDraftYaml(next?.yaml ?? '');
    setRules(nextRules);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const dirty = (policy?.yaml ?? '') !== draftYaml;

  const onSave = async () => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    if (!dirty) { onAction?.('No changes to save'); return; }
    setSaving(true);
    try {
      const result = await savePolicy(draftYaml);
      if (result.ok) { onAction?.('Policy saved; watcher will hot-reload'); await refresh(); }
      else { onAction?.(result.details ? `${result.error}: ${result.details}` : result.error || 'Save failed'); }
    } finally { setSaving(false); }
  };

  const onDiscard = () => { setDraftYaml(policy?.yaml ?? ''); onAction?.('Discarded unsaved edits'); };

  const onReload = async () => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    const ok = await reloadPolicy();
    onAction?.(ok ? 'Policy reload signaled' : 'Reload failed');
    if (ok) await refresh();
  };

  const onToggleRule = async (rule: ActivePolicyRule) => {
    if (!canMutate) return;
    if (rule.enabled && rule.action === 'block' && (rule.patternCount + rule.argPatternCount + rule.denyCount) > 0) {
      if (!confirm(`Disable "${rule.name}"? This appears to be a protection rule.`)) return;
    }
    setRuleBusy(rule.name);
    try {
      const result = await togglePolicyRule(rule.name, !rule.enabled);
      if (!result.ok) { onAction?.(result.details ? `${result.error}: ${result.details}` : result.error || 'Toggle failed'); return; }
      onAction?.(`Rule "${rule.name}" ${rule.enabled ? 'disabled' : 'enabled'}`);
      if (result.warning) onAction?.(result.warning);
      await refresh();
    } finally { setRuleBusy(null); }
  };

  const onDeleteRule = async (rule: ActivePolicyRule) => {
    if (!canMutate) return;
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    if (rule.action === 'block' && (rule.patternCount + rule.argPatternCount + rule.denyCount) > 0) {
      if (!confirm(`Delete protection rule "${rule.name}"? Safety may be reduced.`)) return;
    }
    setRuleBusy(rule.name);
    try {
      const result = await removePolicyRule(rule.name);
      if (!result.ok) { onAction?.(result.details ? `${result.error}: ${result.details}` : result.error || 'Delete failed'); return; }
      onAction?.(`Rule "${rule.name}" deleted`);
      if (result.warning) onAction?.(result.warning);
      await refresh();
    } finally { setRuleBusy(null); }
  };

  const runTest = async (tool?: string, args?: Record<string, unknown>) => {
    if (!canTest) { onAction?.('Requires operator role'); return; }
    let parsed: Record<string, unknown>;
    if (args) {
      parsed = args;
    } else {
      try { parsed = JSON.parse(testArgs) as Record<string, unknown>; }
      catch { setTestResult('Invalid JSON in arguments'); return; }
    }
    const result = await testPolicy({
      tool: tool || testTool || lastBlocked?.tool_name || 'read_file',
      arguments: parsed,
      server: lastBlocked?.server_name,
    });
    const output = result ? JSON.stringify(result, null, 2) : 'Policy test failed';
    setTestResult(output);
    setTestHistory((prev) => [output, ...prev].slice(0, 20));
  };

  const onReplayLastBlocked = () => {
    if (!lastBlocked) { onAction?.('No blocked example available'); return; }
    setTestTool(lastBlocked.tool_name);
    const args = { query: lastBlocked.reason || 'test' };
    setTestArgs(JSON.stringify(args, null, 2));
    void runTest(lastBlocked.tool_name, args);
  };

  const onGenerateCopilot = async () => {
    if (!canTest) { onAction?.('Requires operator role'); return; }
    const g = copilotGoal.trim();
    if (!g) { onAction?.('Describe a policy goal first'); return; }
    setCopilotBusy(true);
    try {
      const result = await fetchPolicyCopilot(g);
      if (!result) { onAction?.('Policy Copilot unavailable'); return; }
      setCopilotYaml(String(result.yaml || ''));
      onAction?.('Copilot generated policy suggestion');
    } finally { setCopilotBusy(false); }
  };

  const totalRules = rules.length;
  const enabledRules = rules.filter((r) => r.enabled).length;
  const disabledRules = rules.filter((r) => !r.enabled).length;
  const blockingRules = rules.filter((r) => r.action === 'block' && r.enabled).length;

  const filteredRules = useMemo(() => {
    const q = ruleFilter.trim().toLowerCase();
    return !q ? rules : rules.filter(
      (r) => r.name.toLowerCase().includes(q) || r.action.toLowerCase().includes(q)
    );
  }, [rules, ruleFilter]);

  const toggleSelectAll = () => {
    if (selectedRules.size === filteredRules.length) {
      setSelectedRules(new Set());
    } else {
      setSelectedRules(new Set(filteredRules.map((r) => r.name)));
    }
  };

  const toggleSelect = (name: string) => {
    setSelectedRules((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const bulkToggle = async (enable: boolean) => {
    if (!canMutate) return;
    for (const name of selectedRules) {
      const rule = rules.find((r) => r.name === name);
      if (!rule || rule.enabled === enable) continue;
      setRuleBusy(name);
      try {
        const result = await togglePolicyRule(name, enable);
        if (!result.ok) { onAction?.(`Failed to ${enable ? 'enable' : 'disable'} "${name}"`); continue; }
        if (result.warning) onAction?.(result.warning);
      } finally { setRuleBusy(null); }
    }
    setSelectedRules(new Set());
    onAction?.(`Bulk ${enable ? 'enable' : 'disable'} applied to ${selectedRules.size} rules`);
    await refresh();
  };

  const bulkDelete = async () => {
    if (!canMutate) return;
    if (!confirm(`Delete ${selectedRules.size} selected rules?`)) return;
    for (const name of selectedRules) {
      setRuleBusy(name);
      try {
        const result = await removePolicyRule(name);
        if (!result.ok) { onAction?.(`Failed to delete "${name}"`); continue; }
        if (result.warning) onAction?.(result.warning);
      } finally { setRuleBusy(null); }
    }
    setSelectedRules(new Set());
    onAction?.(`Bulk delete applied to ${selectedRules.size} rules`);
    await refresh();
  };

  const renderRulesView = () => (
    <div>
      <div className="kpi-grid">
        <KpiCard label="Total Rules" value={totalRules} accent="info" secondary="All configured rules" />
        <KpiCard label="Enabled" value={enabledRules} accent="success" secondary={`${totalRules > 0 ? ((enabledRules / totalRules) * 100).toFixed(0) : 0}% coverage`} />
        <KpiCard label="Disabled" value={disabledRules} accent="neutral" secondary={`${totalRules > 0 ? ((disabledRules / totalRules) * 100).toFixed(0) : 0}% inactive`} />
        <KpiCard label="Blocking Rules" value={blockingRules} accent={blockingRules > 0 ? 'danger' : 'neutral'} secondary="Active protection rules" />
      </div>

      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        <input
          className="input"
          placeholder="Search rules by name or action…"
          style={{ maxWidth: 320 }}
          value={ruleFilter}
          onChange={(e) => setRuleFilter(e.target.value)}
        />
        <span className="text-xs text-muted">
          {filteredRules.length} of {totalRules} rules
        </span>
      </div>

      {/* Bulk actions bar */}
      {selectedRules.size > 0 && (
        <div className="flex items-center gap-2" style={{ marginBottom: 8, padding: '6px 12px', background: 'var(--bg-muted)', borderRadius: 6 }}>
          <span className="text-xs font-medium">{selectedRules.size} selected</span>
          <Button size="sm" disabled={!canMutate} onClick={() => void bulkToggle(true)}>Enable all</Button>
          <Button size="sm" disabled={!canMutate} onClick={() => void bulkToggle(false)}>Disable all</Button>
          <Button size="sm" variant="danger" disabled={!canMutate} onClick={() => void bulkDelete()}>Delete all</Button>
        </div>
      )}

      {filteredRules.length === 0 ? (
        <EmptyState title="No rules found" message={ruleFilter ? 'Try a different search term' : 'No policy rules have been created yet'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" onChange={toggleSelectAll} checked={selectedRules.size === filteredRules.length && filteredRules.length > 0} />
                </th>
                <th>Rule Name</th>
                <th>Action</th>
                <th>Status</th>
                <th>Matchers</th>
                <th style={{ width: 200 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((rule) => (
                <tr key={rule.name}>
                  <td>
                    <input type="checkbox" checked={selectedRules.has(rule.name)} onChange={() => toggleSelect(rule.name)} />
                  </td>
                  <td><span className="font-medium">{rule.name}</span></td>
                  <td>
                    <Badge variant={rule.action === 'block' ? 'danger' : rule.action === 'flag' ? 'warning' : 'success'}>
                      {rule.action}
                    </Badge>
                  </td>
                  <td>
                    <Badge variant={rule.enabled ? 'live' : 'offline'}>
                      {rule.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </td>
                  <td className="mono">{rule.patternCount + rule.argPatternCount}</td>
                  <td>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant={rule.enabled ? 'secondary' : 'primary'}
                        disabled={!canMutate || ruleBusy === rule.name}
                        onClick={() => void onToggleRule(rule)}
                      >
                        {rule.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canMutate || ruleBusy === rule.name}
                        onClick={() => void onDeleteRule(rule)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderEditorView = () => (
    <div>
      <Card title="Policy Configuration" subtitle={
        <>
          Mode: <strong>{policy?.mode ?? '—'}</strong>
          {policy?.path ? <> · <code>{policy.path}</code></> : null}
        </>
      }>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Button
            variant="primary"
            disabled={!canMutate || !dirty || saving}
            onClick={() => void onSave()}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="secondary"
            disabled={!canMutate || !dirty || saving}
            onClick={onDiscard}
          >
            Discard
          </Button>
          <Button
            variant="ghost"
            disabled={!canMutate}
            onClick={() => void onReload()}
          >
            Reload
          </Button>
          {dirty && <Badge variant="warning">Unsaved changes</Badge>}
        </div>

        {policy?.yaml || canMutate ? (
          <div className="mb-3">
            <div className="text-xs text-muted mb-1">
              Active policy YAML{dirty ? ' (unsaved changes)' : ''}
            </div>
            <textarea
              className="input textarea"
              readOnly={!canMutate}
              rows={14}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
              value={draftYaml}
              onChange={(e) => setDraftYaml(e.target.value)}
              spellCheck={false}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">No policy file loaded on proxy (start with --policy).</p>
        )}
      </Card>

      <Card title="Policy Copilot">
        <p className="hint" style={{ marginBottom: 8 }}>
          Describe a rule in plain language — Copilot generates YAML for review.
        </p>
        <label className="policy-field">
          <span className="text-xs text-muted" style={{ display: 'block', marginBottom: 4 }}>Policy goal</span>
          <textarea
            className="input textarea"
            rows={3}
            value={copilotGoal}
            onChange={(e) => setCopilotGoal(e.target.value)}
            placeholder="Block exfil to .env via read_file"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
          />
        </label>
        <div className="flex gap-2" style={{ marginTop: 8 }}>
          <Button variant="primary" disabled={!canTest || copilotBusy} onClick={() => void onGenerateCopilot()}>
            {copilotBusy ? 'Generating…' : 'Generate'}
          </Button>
        </div>
        {copilotYaml && (
          <div style={{ marginTop: 12 }}>
            <div className="text-xs text-muted mb-1">Generated YAML</div>
            <pre className="code-block" style={{ fontSize: 11, maxHeight: 300, overflow: 'auto' }}>
              {copilotYaml}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );

  const renderTestView = () => (
    <Card title="Policy Validation" subtitle="Test tool calls against the active policy">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Button
          size="sm"
          variant="secondary"
          disabled={!canTest || !lastBlocked}
          onClick={onReplayLastBlocked}
        >
          Replay last blocked example
        </Button>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div style={{ flex: 1 }}>
          <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 2 }}>Tool name</label>
          <input className="input" value={testTool} onChange={(e) => setTestTool(e.target.value)} placeholder="read_file" />
        </div>
        <div style={{ flex: 2 }}>
          <label className="text-xs text-muted" style={{ display: 'block', marginBottom: 2 }}>Arguments (JSON)</label>
          <input className="input" value={testArgs} onChange={(e) => setTestArgs(e.target.value)} />
        </div>
        <Button size="sm" variant="primary" disabled={!canTest} onClick={() => void runTest()} style={{ marginTop: 18 }}>
          Run test
        </Button>
      </div>

      {testResult && (
        <div style={{ marginTop: 12 }}>
          <div className="text-xs text-muted mb-1">Test result</div>
          <pre className="mono" style={{ fontSize: 11, background: 'var(--bg-muted)', padding: 12, borderRadius: 6, maxHeight: 200, overflow: 'auto' }}>
            {testResult}
          </pre>
        </div>
      )}

      {testHistory.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="text-xs text-muted mb-1">Recent test history</div>
          <div style={{ maxHeight: 200, overflow: 'auto' }}>
            {testHistory.map((entry, i) => (
              <details key={i} style={{ marginBottom: 4 }}>
                <summary className="text-xs" style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
                  Test #{testHistory.length - i}
                </summary>
                <pre className="mono" style={{ fontSize: 10, background: 'var(--bg-muted)', padding: 8, borderRadius: 4, marginTop: 4, maxHeight: 120, overflow: 'auto' }}>
                  {entry}
                </pre>
              </details>
            ))}
          </div>
        </div>
      )}
    </Card>
  );

  const renderHistoryView = () => (
    <Card title="Policy History">
      <EmptyState
        title="Coming soon"
        message="Policy version history tracking coming soon with Git-backed policy management"
      />
    </Card>
  );

  return (
    <section aria-label="Policy Control Center">
      <div className="page-header">
        <div>
          <h1>Policy Control Center</h1>
          <p>Govern MCP access policies — rules, editor, testing, and version history</p>
        </div>
      </div>

      <WorkspaceSubNav tabs={VIEW_LABELS} active={view} onChange={onViewChange} />

      {view === 'rules' && renderRulesView()}
      {view === 'editor' && renderEditorView()}
      {view === 'test' && renderTestView()}
      {view === 'eval' && <EvalPlaygroundPanel refreshKey={0} />}
      {view === 'review' && <CorpusReviewPanel refreshKey={0} />}
      {view === 'history' && renderHistoryView()}
    </section>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { PolicyCopilotPanel } from './PolicyCopilotPanel';
import {
  fetchPolicyRules,
  fetchPolicy,
  removePolicyRule,
  reloadPolicy,
  savePolicy,
  testPolicy,
  togglePolicyRule,
  type ActivePolicyRule,
  type PolicyInfo,
} from '@/lib/mastyf-ai-api';
import { hasPermission } from '@/lib/dashboard-roles';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

type Props = {
  roles?: string[];
  lastBlocked?: { tool_name: string; server_name: string; reason: string | null } | null;
  onAction?: (msg: string) => void;
  copilotInitialTab?: 'generate' | 'counterfactual';
};

export function PolicyPanel({ roles, lastBlocked, onAction, copilotInitialTab }: Props) {
  const canTest = hasPermission(roles, 'policy_test');
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [policy, setPolicy] = useState<PolicyInfo | null>(null);
  const [draftYaml, setDraftYaml] = useState('');
  const [saving, setSaving] = useState(false);
  const [ruleBusy, setRuleBusy] = useState<string | null>(null);
  const [rules, setRules] = useState<ActivePolicyRule[]>([]);
  const [ruleFilter, setRuleFilter] = useState('');
  const [testResult, setTestResult] = useState('');
  const [testTool, setTestTool] = useState('');
  const [testArgs, setTestArgs] = useState('{"query": "test"}');

  const refresh = useCallback(async () => {
    const [next, nextRules] = await Promise.all([fetchPolicy(), fetchPolicyRules()]);
    setPolicy(next);
    setDraftYaml(next?.yaml ?? '');
    setRules(nextRules);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runTest = async () => {
    if (!canTest) { onAction?.('Requires operator role'); return; }
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(testArgs) as Record<string, unknown>; }
    catch { setTestResult('Invalid JSON in arguments'); return; }
    const result = await testPolicy({
      tool: testTool || lastBlocked?.tool_name || 'read_file',
      arguments: args,
      server: lastBlocked?.server_name,
    });
    setTestResult(result ? JSON.stringify(result, null, 2) : 'Policy test failed');
  };

  const onReload = async () => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    const ok = await reloadPolicy();
    onAction?.(ok ? 'Policy reload signaled' : 'Reload failed');
    if (ok) await refresh();
  };

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

  const filteredRules = rules.filter((rule) => {
    const q = ruleFilter.trim().toLowerCase();
    return !q || rule.name.toLowerCase().includes(q) || rule.action.toLowerCase().includes(q);
  });

  return (
    <div>
      {/* Policy Copilot */}
      <PolicyCopilotPanel roles={roles} onAction={onAction} initialTab={copilotInitialTab} />

      {/* Policy Mode Status */}
      <Card title="Policy Studio" subtitle={
        <>
          Mode: <strong>{policy?.mode ?? '—'}</strong>
          {policy?.path ? <> · <code>{policy.path}</code></> : null}
        </>
      }>
        <div className="flex items-center gap-2 mb-3">
          <input
            className="input"
            placeholder="Search active rules…"
            style={{ maxWidth: 280 }}
            value={ruleFilter}
            onChange={(e) => setRuleFilter(e.target.value)}
          />
          <span className="text-xs text-muted">
            {rules.length} total · {rules.filter(r => r.enabled).length} enabled · {rules.filter(r => !r.enabled).length} disabled
          </span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Action</th>
                <th>Status</th>
                <th>Matchers</th>
                <th style={{ width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((rule) => (
                <tr key={rule.name}>
                  <td><span className="font-medium">{rule.name}</span></td>
                  <td>
                    <Badge variant={rule.action === 'block' ? 'danger' : rule.action === 'flag' ? 'warning' : 'success'}>
                      {rule.action}
                    </Badge>
                  </td>
                  <td>
                    <Badge variant={rule.enabled ? 'live' : 'neutral'}>
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
      </Card>

      {/* Deploy Actions */}
      <Card title="Deploy Policy">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Button
            variant="primary"
            disabled={!canMutate || !dirty || saving}
            onClick={() => void onSave()}
          >
            {saving ? 'Saving…' : 'Save policy changes'}
          </Button>
          <Button
            variant="secondary"
            disabled={!canMutate || !dirty || saving}
            onClick={onDiscard}
          >
            Discard draft changes
          </Button>
          <Button
            variant="ghost"
            disabled={!canMutate}
            onClick={() => void onReload()}
          >
            Reload policy on proxy
          </Button>
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

      {/* Validate */}
      <Card title="Policy Validation" subtitle="Test tool calls against the active policy">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            disabled={!canTest}
            onClick={() => {
              if (lastBlocked) { setTestTool(lastBlocked.tool_name); setTestArgs(JSON.stringify({ query: lastBlocked.reason || 'test' })); }
              void runTest();
            }}
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
          <pre className="mono" style={{ fontSize: 11, background: 'var(--bg-muted)', padding: 12, borderRadius: 6, maxHeight: 200, overflow: 'auto', marginTop: 8 }}>
            {testResult}
          </pre>
        )}
      </Card>
    </div>
  );
}

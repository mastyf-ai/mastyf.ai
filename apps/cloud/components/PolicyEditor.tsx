'use client';

import { useEffect, useState } from 'react';
import { SITE_NAME } from '@/lib/product-links';

type ActiveRule = {
  name: string;
  action: 'pass' | 'block' | 'flag';
  enabled: boolean;
  patternCount: number;
  argPatternCount: number;
};

export function PolicyEditor({ initialYaml }: { initialYaml: string }) {
  const [yaml, setYaml] = useState(initialYaml);
  const [rules, setRules] = useState<ActiveRule[]>([]);
  const [ruleFilter, setRuleFilter] = useState('');
  const [ruleBusy, setRuleBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setYaml(initialYaml);
  }, [initialYaml]);

  const refreshRules = async () => {
    const res = await fetch('/api/v1/policy/rules');
    if (!res.ok) return;
    const data = (await res.json()) as { rules?: ActiveRule[] };
    setRules(data.rules ?? []);
  };

  useEffect(() => {
    void refreshRules();
  }, []);

  const onSave = async () => {
    setSaving(true);
    setStatus('');
    try {
      const res = await fetch('/api/v1/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Save failed');
      }
      setStatus('Saved');
      await refreshRules();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onDownload = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'policy.yaml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onToggleRule = async (rule: ActiveRule) => {
    const isCritical = rule.action === 'block' && (rule.patternCount + rule.argPatternCount) > 0;
    if (rule.enabled && isCritical) {
      const confirmed = confirm(
        `Disable "${rule.name}"? This appears to be a protection rule and may reduce blocking coverage.`,
      );
      if (!confirmed) return;
    }
    setRuleBusy(rule.name);
    setStatus('');
    try {
      const res = await fetch('/api/v1/policy/rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rule.name, enabled: !rule.enabled }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Rule update failed');
      }
      const data = (await res.json().catch(() => ({}))) as { warning?: string };
      setStatus(data.warning || `Rule "${rule.name}" ${rule.enabled ? 'disabled' : 'enabled'}`);
      await Promise.all([refreshRules(), (async () => {
        const policyRes = await fetch('/api/v1/policy', { headers: { Accept: 'text/yaml' } });
        if (policyRes.ok) setYaml(await policyRes.text());
      })()]);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Rule update failed');
    } finally {
      setRuleBusy(null);
    }
  };

  const onDeleteRule = async (rule: ActiveRule) => {
    if (!confirm(`Delete rule "${rule.name}" from policy YAML?`)) return;
    const isCritical = rule.action === 'block' && (rule.patternCount + rule.argPatternCount) > 0;
    if (isCritical) {
      const confirmed = confirm(
        `Delete "${rule.name}"? This appears to be a protection rule and may reduce blocking coverage.`,
      );
      if (!confirmed) return;
    }
    setRuleBusy(rule.name);
    setStatus('');
    try {
      const res = await fetch('/api/v1/policy/rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rule.name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Rule delete failed');
      }
      const data = (await res.json().catch(() => ({}))) as { warning?: string };
      setStatus(data.warning || `Rule "${rule.name}" deleted`);
      await Promise.all([refreshRules(), (async () => {
        const policyRes = await fetch('/api/v1/policy', { headers: { Accept: 'text/yaml' } });
        if (policyRes.ok) setYaml(await policyRes.text());
      })()]);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Rule delete failed');
    } finally {
      setRuleBusy(null);
    }
  };

  const filteredRules = rules.filter((rule) => {
    const q = ruleFilter.trim().toLowerCase();
    if (!q) return true;
    return rule.name.toLowerCase().includes(q) || rule.action.toLowerCase().includes(q);
  });

  return (
    <div className="card">
      <h2>Active rules</h2>
      <p className="muted">
        {rules.length} total · {rules.filter((r) => r.enabled).length} enabled · {rules.filter((r) => !r.enabled).length} disabled
      </p>
      <input
        className="policy-editor"
        style={{ minHeight: 0, height: 42, marginBottom: '1rem' }}
        value={ruleFilter}
        onChange={(e) => setRuleFilter(e.target.value)}
        placeholder="Filter rules by name or action"
      />
      <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
        <table style={{ width: '100%' }}>
          <thead>
            <tr>
              <th align="left">Rule</th>
              <th align="left">Action</th>
              <th align="left">Status</th>
              <th align="left">Matchers</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filteredRules.map((rule) => (
              <tr key={rule.name}>
                <td>{rule.name}</td>
                <td>{rule.action}</td>
                <td>{rule.enabled ? 'Enabled' : 'Disabled'}</td>
                <td>{rule.patternCount + rule.argPatternCount}</td>
                <td className="actions">
                  <button type="button" className="btn" onClick={() => void onToggleRule(rule)} disabled={ruleBusy === rule.name}>
                    {rule.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="btn" onClick={() => void onDeleteRule(rule)} disabled={ruleBusy === rule.name}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Policy YAML</h2>
      <p className="muted">
        Edit your tenant policy on {SITE_NAME}. Download the YAML or pull it via{' '}
        <code>/api/v1/policy</code>. Download the YAML or sync to a self-hosted proxy via the API.
      </p>
      <textarea
        className="policy-editor"
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        spellCheck={false}
      />
      <div className="actions" style={{ marginTop: '1rem' }}>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={onDownload}>
          Download
        </button>
      </div>
      {status && <p className={status === 'Saved' ? 'alert-success alert' : 'alert-warn alert'}>{status}</p>}
    </div>
  );
}

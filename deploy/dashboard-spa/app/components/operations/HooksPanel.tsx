'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchHooks, toggleHook, type HookInfo } from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';

async function registerCustomHook(name: string, code: string, type: string, priority: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/hooks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code, type, priority }),
    });
    if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; return { ok: false, error: d.error }; }
    return { ok: true };
  } catch (err: any) { return { ok: false, error: err.message }; }
}

type Props = {
  refreshKey: number;
};

export default function HooksPanel({ refreshKey }: Props) {
  const [hooks, setHooks] = useState<HookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customForm, setCustomForm] = useState({ name: '', code: 'return { allowed: true };', type: 'before' as string, priority: 50 });

  const load = useCallback(async () => {
    setLoading(true);
    const h = await fetchHooks();
    setHooks(h);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const handleToggle = async (hook: HookInfo) => {
    setStatus(`Toggling ${hook.name}...`);
    const res = await toggleHook(hook.name, !hook.enabled);
    setStatus(res.ok ? `${hook.name} ${!hook.enabled ? 'enabled' : 'disabled'}` : (res.error || 'Failed'));
    if (res.ok) await load();
  };

  if (loading) return <div className="p-4 text-muted text-sm">Loading hooks…</div>;

  const beforeHooks = hooks.filter(h => h.type === 'before');
  const afterHooks = hooks.filter(h => h.type === 'after');
  const errorHooks = hooks.filter(h => h.type === 'error');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {status && <div style={{ padding: '8px 12px', background: 'var(--bg-muted)', borderRadius: 6, fontSize: 13 }}>{status}</div>}

      <Card title="Tool-Call Hooks" subtitle="Manage pre/post tool-call hooks for custom business logic">
        {hooks.length === 0 ? (
          <EmptyState title="No Hooks Registered" message="Hooks run custom JavaScript before or after every tool call. Register hooks via the plugin SDK or npm packages." />
        ) : (
          <>
            {beforeHooks.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Before Hooks (pre-call)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {beforeHooks.map(h => <HookRow key={h.name} hook={h} onToggle={handleToggle} />)}
                </div>
              </div>
            )}
            {afterHooks.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>After Hooks (post-call)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {afterHooks.map(h => <HookRow key={h.name} hook={h} onToggle={handleToggle} />)}
                </div>
              </div>
            )}
            {errorHooks.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Error Hooks</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {errorHooks.map(h => <HookRow key={h.name} hook={h} onToggle={handleToggle} />)}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setShowCustom(!showCustom)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 13 }}>
          + Register Custom Hook
        </button>
      </div>

      {showCustom && (
        <Card title="Register Custom Hook">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>Hook Name</span>
              <input value={customForm.name} onChange={e => setCustomForm({ ...customForm, name: e.target.value })} placeholder="my-custom-hook"
                style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>Type</span>
              <select value={customForm.type} onChange={e => setCustomForm({ ...customForm, type: e.target.value })}
                style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 13 }}>
                <option value="before">Before (pre-call)</option>
                <option value="after">After (post-call)</option>
                <option value="error">Error</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>Priority (lower = runs first)</span>
              <input type="number" value={customForm.priority} onChange={e => setCustomForm({ ...customForm, priority: parseInt(e.target.value) || 50 })}
                style={{ width: 100, marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>Code (JavaScript function body)</span>
              <textarea value={customForm.code} onChange={e => setCustomForm({ ...customForm, code: e.target.value })} rows={6}
                placeholder="return { allowed: true };" style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }} />
            </label>
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              Before hooks: return <code style={{ fontSize: 10, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{'{ allowed: true }'}</code> or <code style={{ fontSize: 10, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{'{ allowed: false, reason: "..." }'}</code><br />
              After hooks: return <code style={{ fontSize: 10, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{'{ allowed: true, modifiedResult: ... }'}</code><br />
              Available variables: <code style={{ fontSize: 10, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>context</code> (tool, identity, tenantId) and <code style={{ fontSize: 10, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>result</code> (output, durationMs, error)
            </div>
            <button
              onClick={async () => {
                if (!customForm.name) { setStatus('Name required'); return; }
                const res = await registerCustomHook(customForm.name, customForm.code, customForm.type, customForm.priority);
                setStatus(res.ok ? `Registered "${customForm.name}"` : (res.error || 'Failed'));
                if (res.ok) { setShowCustom(false); setCustomForm({ name: '', code: 'return { allowed: true };', type: 'before', priority: 50 }); await load(); }
              }}
              style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              Register Hook
            </button>
          </div>
        </Card>
      )}

      <Card title="Built-in Hooks">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p>Mastyf ships with three built-in hook types:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li><strong>Rate Limiter</strong> — per-tool, per-user call rate enforcement</li>
            <li><strong>PII Redaction</strong> — strips sensitive fields from tool responses</li>
            <li><strong>Sensitive Path Guard</strong> — restricts file access to allowed paths</li>
          </ul>
          <p style={{ marginTop: 8 }}>Register built-in hooks through the plugin SDK or by adding npm packages to <code style={{ fontSize: 11, background: 'var(--bg-muted)', padding: '1px 4px', borderRadius: 3 }}>MASTYF_AI_PLUGIN_PATH</code>.</p>
        </div>
      </Card>
    </div>
  );
}

function HookRow({ hook, onToggle }: { hook: HookInfo; onToggle: (h: HookInfo) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f3f4f6', borderRadius: 6 }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{hook.name}</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          {hook.type} hook {hook.priority != null ? `(priority: ${hook.priority})` : ''}
        </div>
      </div>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(hook); }}
        style={{
          padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          background: hook.enabled ? '#16a34a' : '#d1d5db',
          color: '#fff', minWidth: 90,
        }}>
        {hook.enabled ? 'Enabled' : 'Disabled'}
      </button>
    </div>
  );
}

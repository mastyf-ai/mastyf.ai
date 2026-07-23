'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchSsoSettings, fetchSsoProviders, saveSsoConfig, deleteSsoConfig, type IdpConfigFull, type SsoProviderSummary } from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';

type Props = {
  refreshKey: number;
};

export default function SsoSettingsPanel({ refreshKey }: Props) {
  const [configs, setConfigs] = useState<IdpConfigFull[]>([]);
  const [providers, setProviders] = useState<SsoProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<Partial<IdpConfigFull> & { clientSecret?: string }>({
    name: '', providerType: 'oidc', issuerUrl: '', clientId: '',
    clientSecret: '', redirectUri: '', scopes: ['openid', 'email', 'profile'], enabled: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [c, p] = await Promise.all([fetchSsoSettings(), fetchSsoProviders()]);
    setConfigs(c);
    setProviders(p);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const handleSave = async () => {
    if (!form.name || !form.issuerUrl || !form.clientId || !form.clientSecret || !form.redirectUri) {
      setStatus('All required fields must be filled');
      return;
    }
    setSaving(true);
    const res = await saveSsoConfig(form);
    setSaving(false);
    setStatus(res.ok ? 'Saved' : (res.error || 'Save failed'));
    if (res.ok) { setShowForm(false); setForm({ name: '', providerType: 'oidc', issuerUrl: '', clientId: '', clientSecret: '', redirectUri: '', scopes: ['openid', 'email', 'profile'], enabled: true }); await load(); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this SSO provider?')) return;
    const res = await deleteSsoConfig(id);
    setStatus(res.ok ? 'Removed' : (res.error || 'Delete failed'));
    if (res.ok) await load();
  };

  if (loading) return <div className="p-4 text-muted text-sm">Loading SSO settings…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {status && <div className="text-sm" style={{ color: status === 'Saved' || status === 'Removed' ? 'var(--brand-success)' : 'var(--brand-danger)', padding: '8px 12px', background: 'var(--bg-muted)', borderRadius: 6 }}>{status}</div>}

      <Card title="SSO Providers" subtitle="Configure OIDC identity providers for federated login">
        {configs.length === 0 ? (
          <EmptyState title="No SSO Providers" message="Add an OIDC provider like Okta, Auth0, or Entra ID to enable federated login." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {configs.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-muted)', borderRadius: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.issuerUrl} • {c.providerType.toUpperCase()}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: c.enabled ? 'var(--brand-success)' : 'var(--text-muted)', color: '#fff' }}>{c.enabled ? 'Active' : 'Disabled'}</span>
                  <button onClick={() => handleDelete(c.id)} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--brand-danger)' }}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!showForm && (
          <button onClick={() => setShowForm(true)} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--brand-primary)', color: '#fff', cursor: 'pointer', fontSize: 13 }}>+ Add SSO Provider</button>
        )}
      </Card>

      {showForm && (
        <Card title="Add OIDC Provider">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <InputField label="Display Name" value={form.name || ''} onChange={v => setForm({ ...form, name: v })} placeholder="e.g., Okta Production" />
            <InputField label="Issuer URL" value={form.issuerUrl || ''} onChange={v => setForm({ ...form, issuerUrl: v })} placeholder="https://dev-123.okta.com" />
            <InputField label="Client ID" value={form.clientId || ''} onChange={v => setForm({ ...form, clientId: v })} />
            <InputField label="Client Secret" value={form.clientSecret || ''} onChange={v => setForm({ ...form, clientSecret: v })} type="password" />
            <InputField label="Redirect URI" value={form.redirectUri || ''} onChange={v => setForm({ ...form, redirectUri: v })} placeholder="http://localhost:4000/api/auth/sso/callback/my-idp" />
            <InputField label="Scopes (comma-separated)" value={(form.scopes || []).join(', ')} onChange={v => setForm({ ...form, scopes: v.split(',').map(s => s.trim()) })} placeholder="openid, email, profile" />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={form.enabled !== false} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
              Enabled
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--brand-primary)', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Saving…' : 'Save Provider'}
              </button>
              <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        </Card>
      )}

      <Card title="Available Providers">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p>Supported identity providers: <strong>Okta</strong>, <strong>Auth0</strong>, <strong>Microsoft Entra ID</strong>, <strong>Clerk</strong>, <strong>Google</strong>, <strong>Keycloak</strong>, and any OIDC-compliant IdP.</p>
          <p style={{ marginTop: 8 }}>To connect: register a new OAuth 2.0 app in your IdP with the redirect URI shown above, then paste the credentials here.</p>
        </div>
      </Card>
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, type }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 13 }} />
    </label>
  );
}

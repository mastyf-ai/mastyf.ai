'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';

export default function CredentialsPanel() {
  const [creds, setCreds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ providerName: 'github', providerId: 'github', credentialType: 'bearer_token', token: '', scopes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/credentials');
      const data = await res.json();
      setCreds(data.credentials || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleStore = async () => {
    if (!form.token) { setStatus('Token required'); return; }
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerName: form.providerName, providerId: form.providerId,
          credentialType: form.credentialType, token: form.token,
          scopes: form.scopes.split(',').map((s: string) => s.trim()).filter(Boolean),
        }),
      });
      if (res.ok) setStatus('Stored'); else setStatus('Failed');
      setShowAdd(false); setForm({ providerName: 'github', providerId: 'github', credentialType: 'bearer_token', token: '', scopes: '' }); await load();
    } catch { setStatus('Error'); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {status && <div style={{ padding: '8px 14px', background: '#eff6ff', borderRadius: 6, fontSize: 13, color: '#1e40af' }}>{status}</div>}

      <Card title={`Credentials (${creds.length})`} subtitle="Stored API keys and OAuth tokens are encrypted with AES-256-GCM and auto-injected into upstream requests">
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => setShowAdd(!showAdd)} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Store Credential</button>
        </div>

        {creds.length === 0 ? (
          <EmptyState title="No Credentials" message="Store API keys and OAuth tokens here. They're encrypted at rest and auto-injected into upstream HTTP headers." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {creds.map((c: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f3f4f6', borderRadius: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.provider_name || c.providerName}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{c.credential_type || c.credentialType} · {c.id?.slice(0, 12) || ''}</div>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {c.expires_at ? `Expires: ${new Date(parseInt(c.expires_at, 10)).toLocaleDateString()}` : 'No expiry'}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showAdd && (
        <Card title="Store New Credential">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>Provider</span>
              <input value={form.providerName} onChange={e => setForm({ ...form, providerName: e.target.value })} placeholder="github"
                style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>Token</span>
              <input type="password" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} placeholder="ghp_..."
                style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', fontSize: 13, fontFamily: 'monospace' }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>Scopes (comma-separated)</span>
              <input value={form.scopes} onChange={e => setForm({ ...form, scopes: e.target.value })} placeholder="repo, read:org"
                style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', fontSize: 13 }} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleStore} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Store</button>
              <button onClick={() => setShowAdd(false)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #e5e7eb', background: 'none', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            </div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              Tokens are encrypted with AES-256-GCM before storage. They're auto-injected into Authorization headers on upstream HTTP requests and stripped from responses.
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchThreatFeedSubscriptions, addThreatFeedSubscription, syncThreatFeeds, type ThreatFeedSubscription } from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';

type Props = {
  refreshKey: number;
};

export default function ThreatFeedsPanel({ refreshKey }: Props) {
  const [feeds, setFeeds] = useState<ThreatFeedSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', feedUrl: '' });
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const f = await fetchThreatFeedSubscriptions();
    setFeeds(f);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const handleAdd = async () => {
    if (!form.name || !form.feedUrl) { setStatus('Both fields required'); return; }
    const res = await addThreatFeedSubscription(form);
    setStatus(res.ok ? 'Added' : (res.error || 'Failed'));
    if (res.ok) { setShowAdd(false); setForm({ name: '', feedUrl: '' }); await load(); }
  };

  const handleSync = async () => {
    setSyncing(true);
    const res = await syncThreatFeeds();
    setStatus(res.ok ? 'Sync complete' : (res.error || 'Sync failed'));
    setSyncing(false);
    if (res.ok) await load();
  };

  if (loading) return <div className="p-4 text-muted text-sm">Loading feeds…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {status && <div style={{ padding: '8px 12px', background: 'var(--bg-muted)', borderRadius: 6, fontSize: 13 }}>{status}</div>}

      <Card title="Threat Feed Syndication" subtitle="Subscribe to community threat intel feeds via MTX format">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={handleSync} disabled={syncing} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--brand-primary)', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
            {syncing ? 'Syncing…' : 'Sync All Feeds'}
          </button>
          <button onClick={() => setShowAdd(!showAdd)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 13 }}>
            + Add Feed
          </button>
        </div>

        {feeds.length === 0 ? (
          <EmptyState title="No Threat Feeds" message="Subscribe to community threat intelligence feeds to receive real-time MCP attack signatures." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {feeds.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, background: 'var(--bg-muted)', borderRadius: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.feedUrl}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{f.addedCount} threats</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{f.lastSync ? `Last sync: ${new Date(f.lastSync).toLocaleDateString()}` : 'Never synced'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showAdd && (
        <Card title="Add Threat Feed">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>Feed Name</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Community Threat Feed"
                style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>Feed URL</span>
              <input value={form.feedUrl} onChange={e => setForm({ ...form, feedUrl: e.target.value })} placeholder="https://feeds.example.com/mastyf-threats.json"
                style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 13 }} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleAdd} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--brand-primary)', color: '#fff', cursor: 'pointer', fontSize: 13 }}>Subscribe</button>
              <button onClick={() => setShowAdd(false)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        </Card>
      )}

      <Card title="About MTX Feed Format">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p>Threat feeds use the <strong>MCP Threat Exchange (MTX) v1.0</strong> format — an open standard for anonymized MCP attack signatures shared across deployments.</p>
          <p style={{ marginTop: 8 }}>Each record contains: tool pattern hash, argument fingerprint hash, attack category, block reason, and report count. No raw tool call data or credentials are shared.</p>
        </div>
      </Card>
    </div>
  );
}

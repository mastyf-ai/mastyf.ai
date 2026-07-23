'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';

type UnverifiedEntry = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  category: string;
  description: string;
  blockRule: string;
  createdAt: string;
};

type Props = {
  refreshKey: number;
  onAction?: (msg: string) => void;
};

export default function CorpusReviewPanel({ refreshKey, onAction }: Props) {
  const [entries, setEntries] = useState<UnverifiedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoCount, setAutoCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/eval/unverified');
      const data = await res.json();
      setEntries(data.entries || []);
      const pres = await fetch('/api/eval/payloads');
      const pdata = await pres.json();
      setAutoCount(pdata.dynamic || 0);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const handleVerify = async (id: string) => {
    try {
      const res = await fetch('/api/eval/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        onAction?.('Corpus entry verified and added to eval payloads');
        await load();
      }
    } catch {}
  };

  const handleReject = async (id: string) => {
    try {
      const res = await fetch('/api/eval/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reject: id }),
      });
      if (res.ok) {
        onAction?.('Corpus entry rejected');
        await load();
      }
    } catch {}
  };

  const handleVerifyAll = async () => {
    for (const entry of entries) {
      await handleVerify(entry.id);
    }
  };

  const handleRunTribunal = async () => {
    setTribunalStatus('Running...');
    try {
      const res = await fetch('/api/eval/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tribunal: true }),
      });
      const data = await res.json();
      if (data.ok) {
        const { verdicts } = data as { verdicts: Record<string, string> };
        const verified = Object.values(verdicts).filter(v => v === 'verify').length;
        const rejected = Object.values(verdicts).filter(v => v === 'reject').length;
        const pending = Object.values(verdicts).filter(v => v === 'needs_review').length;
        setTribunalStatus(`${verified} verified, ${rejected} rejected, ${pending} need manual review`);
        onAction?.(`Tribunal complete — ${verified} verified, ${rejected} rejected, ${pending} need manual review`);
      } else {
        setTribunalStatus('Tribunal failed');
      }
      await load();
    } catch {
      setTribunalStatus('Tribunal error — check console');
    }
  };

  const [tribunalStatus, setTribunalStatus] = useState('');

  if (loading) return <div className="p-4 text-muted text-sm">Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title={`Pending Review (${entries.length}) · ${autoCount} auto-verified`} subtitle="High-confidence attacks skip review entirely. Only borderline decisions appear here.">
        {entries.length === 0 ? (
          <EmptyState title="All Clear" message="No unverified corpus entries. All blocked calls have been reviewed." />
        ) : (
          <>
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={handleVerifyAll}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Verify All ({entries.length})
              </button>
              <button
                onClick={handleRunTribunal}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #3b82f6', background: '#eff6ff', color: '#1e40af', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                Run Tribunal ({entries.length})
              </button>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                Tribunal auto-reviews based on argument patterns — high-confidence verdicts are applied immediately, borderline cases remain for manual review.
              </span>
            </div>
            {tribunalStatus && (
              <div style={{ marginBottom: 12, padding: '8px 14px', background: '#eff6ff', borderRadius: 6, fontSize: 13, color: '#1e40af', fontWeight: 500 }}>
                Tribunal result: {tribunalStatus}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 500, overflow: 'auto' }}>
              {entries.map(e => (
                <div key={e.id} style={{ padding: '14px 18px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{e.tool}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{e.description}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleVerify(e.id)}
                        style={{ padding: '6px 14px', borderRadius: 4, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                        ✓ Verify
                      </button>
                      <button
                        onClick={() => handleReject(e.id)}
                        style={{ padding: '6px 14px', borderRadius: 4, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                        ✗ Reject
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#9ca3af' }}>
                    <span>Rule: {e.blockRule}</span>
                    <span>Category: {e.category}</span>
                    <span>{new Date(e.createdAt).toLocaleString()}</span>
                  </div>
                  <div style={{ marginTop: 8, padding: '8px 10px', background: '#f3f4f6', borderRadius: 4, fontSize: 11, fontFamily: 'monospace', color: '#374151', maxHeight: 80, overflow: 'auto' }}>
                    {JSON.stringify(e.args, null, 2)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card title="How corpus verification works">
        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>
          <p style={{ marginBottom: 8 }}><strong>Auto-verified (skip review):</strong> detections from deny-dangerous-tools, semantic URL/Shell/SQL guard, encoding-evasion guard, and critical-severity prompt injection.</p>
          <p style={{ marginBottom: 8 }}><strong>Manual review:</strong> all other blocked calls. Verify to add the pattern to the permanent eval corpus. Reject if it was a false positive.</p>
          <p>Verified entries appear in the Policy Eval playground alongside the static corpus, growing your test coverage with real attack data.</p>
        </div>
      </Card>
    </div>
  );
}

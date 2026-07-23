'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchEvalPayloads, runEval, type EvalPayload, type EvalResult, type EvalStats } from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { KpiCard } from '../ui/KpiCard';
import { EmptyState } from '../ui/EmptyState';

type Props = {
  refreshKey: number;
};

export default function EvalPlaygroundPanel({ refreshKey }: Props) {
  const [payloads, setPayloads] = useState<EvalPayload[]>([]);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [stats, setStats] = useState<EvalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState('all');
  const [customJson, setCustomJson] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const p = await fetchEvalPayloads();
    setPayloads(p);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const handleRunAll = async () => {
    setRunning(true);
    const r = await runEval(payloads);
    if (r) {
      setResults(r.results);
      setStats(r.stats);
    }
    setRunning(false);
  };

  const handleRunCustom = async () => {
    try {
      const custom = JSON.parse(customJson) as EvalPayload[];
      setRunning(true);
      const r = await runEval(custom);
      if (r) {
        setResults(r.results);
        setStats(r.stats);
      }
      setRunning(false);
    } catch { alert('Invalid JSON. Paste an array of eval payload objects.'); }
  };

  const filtered = filter === 'all' ? results : filter === 'pass' ? results.filter(r => r.payload.expectedAction === 'pass') : filter === 'block' ? results.filter(r => r.payload.expectedAction === 'block') : results.filter(r => !r.matched);

  if (loading) return <div className="p-4 text-muted text-sm">Loading eval corpus…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <KpiCard label="Accuracy" value={`${stats.accuracy.toFixed(1)}%`} accent={stats.accuracy >= 90 ? 'success' : stats.accuracy >= 70 ? 'warning' : 'danger'} />
          <KpiCard label="True Positives" value={String(stats.truePositives)} accent="success" />
          <KpiCard label="False Negatives" value={String(stats.falseNegatives)} accent="danger" secondary={`${stats.missedCritical} critical missed`} />
          <KpiCard label="Total Tests" value={String(stats.total)} accent="info" secondary={`${stats.correct} correct, ${stats.incorrect} wrong`} />
        </div>
      )}

      <Card title="Policy Eval Playground" subtitle="Test your security policy against attack payloads">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={handleRunAll} disabled={running} style={{ padding: '10px 20px', borderRadius: 6, border: 'none', background: 'var(--brand-primary)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
            {running ? 'Running…' : `Run All (${payloads.length} payloads)`}
          </button>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 13 }}>
            <option value="all">All Results</option>
            <option value="block">Expected Block</option>
            <option value="pass">Expected Pass</option>
            <option value="missed">Missed Detections</option>
          </select>
        </div>

        {stats && stats.byCategory && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {Object.entries(stats.byCategory).map(([cat, c]) => {
              const pct = c.total > 0 ? (c.correct / c.total * 100) : 0;
              return (
                <div key={cat} style={{ padding: '6px 10px', borderRadius: 4, background: pct >= 90 ? '#dcfce7' : pct >= 70 ? '#fef3c7' : '#fee2e2', fontSize: 11, fontWeight: 500 }}>
                  {cat}: {c.correct}/{c.total} ({pct.toFixed(0)}%)
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {results.length > 0 && (
        <Card title={`Results (${filtered.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 500, overflow: 'auto' }}>
            {filtered.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 4, background: r.matched ? 'var(--bg-success)' : 'var(--bg-danger)', fontSize: 13 }}>
                <span style={{ fontWeight: 700, minWidth: 50, color: r.matched ? '#16a34a' : '#dc2626' }}>{r.matched ? '✓ PASS' : '✗ MISS'}</span>
                <span style={{ fontWeight: 500, minWidth: 140 }}>{r.payload.tool}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>{r.payload.description}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.matchedRule} • {r.durationMs}ms</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Custom Payload Tester">
        <textarea
          value={customJson}
          onChange={e => setCustomJson(e.target.value)}
          placeholder='[{"tool":"read_file","args":{"path":"/etc/passwd"},"expectedAction":"block","category":"test","description":"Custom test"}]'
          rows={6}
          style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
        />
        <button onClick={handleRunCustom} style={{ marginTop: 8, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--brand-secondary)', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
          Run Custom Payloads
        </button>
      </Card>
    </div>
  );
}

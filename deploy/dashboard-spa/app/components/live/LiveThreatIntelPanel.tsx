'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchSwarmLatest, fetchThreatLabCandidates } from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

type IntelRow = { id: string; source: string; summary: string; severity?: string };

export function LiveThreatIntelPanel() {
  const [rows, setRows] = useState<IntelRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [latest, candidates] = await Promise.all([fetchSwarmLatest(), fetchThreatLabCandidates()]);
    const out: IntelRow[] = [];
    for (const f of latest?.findings ?? []) {
      out.push({
        id: `${f.source}-${f.summary}`.slice(0, 40),
        source: f.source,
        summary: f.summary,
        severity: f.severity,
      });
    }
    for (const c of candidates.slice(0, 20)) {
      out.push({
        id: c.id,
        source: c.provenance?.source ?? 'threat-lab',
        summary: `${c.attackClass} (${(c.confidence * 100).toFixed(0)}%)`,
        severity: c.reviewStatus === 'accepted' ? 'mitigated' : 'candidate',
      });
    }
    setRows(out);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-muted">Loading live threat intel from session swarm…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted">
        No live intel for this session. Run Security Analysis or Threat Lab to populate findings.
      </p>
    );
  }

  return (
    <Card title="Live Threat Intelligence" subtitle="Swarm findings and Threat Lab candidates">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Summary</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><code className="mono">{r.source}</code></td>
                <td>{r.summary}</td>
                <td>
                  {r.severity === 'high' || r.severity === 'critical' ? (
                    <Badge variant="danger">{r.severity}</Badge>
                  ) : r.severity === 'medium' ? (
                    <Badge variant="warning">{r.severity}</Badge>
                  ) : r.severity === 'mitigated' ? (
                    <Badge variant="success">{r.severity}</Badge>
                  ) : r.severity === 'candidate' ? (
                    <Badge variant="neutral">{r.severity}</Badge>
                  ) : (
                    <span className="text-xs text-muted">{r.severity ?? '—'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="ghost" size="sm" onClick={() => void load()} style={{ marginTop: 12 }}>
        Refresh intel
      </Button>
    </Card>
  );
}

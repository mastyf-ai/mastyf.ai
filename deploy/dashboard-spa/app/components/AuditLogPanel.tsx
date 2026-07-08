'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchAuditLogs, type AuditLogEntry } from '@/lib/auth-admin-api';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resultFilter, setResultFilter] = useState<'' | 'success' | 'failure'>('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const refresh = useCallback(async () => {
    setLoading(true);
    const { entries: e, total: t } = await fetchAuditLogs({
      result: resultFilter || undefined,
      limit,
      offset,
    });
    setEntries(e);
    setTotal(t);
    setLoading(false);
  }, [resultFilter, offset]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Card
      title="Audit Log"
      subtitle="Login/logout, password changes, and user/group/role/settings changes"
      actions={
        <select
          className="input"
          style={{ width: 140, height: 30, fontSize: 12 }}
          value={resultFilter}
          onChange={(e) => { setOffset(0); setResultFilter(e.target.value as 'success' | 'failure' | ''); }}
        >
          <option value="">All results</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </select>
      }
    >
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">No audit entries yet.</p>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Timestamp</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>User</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Action</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Result</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>IP</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>User agent</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{new Date(e.createdAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 8px' }}>{e.username || '—'}</td>
                  <td style={{ padding: '6px 8px' }} className="mono">{e.action}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <Badge variant={e.result === 'success' ? 'success' : 'danger'} dot>{e.result}</Badge>
                  </td>
                  <td style={{ padding: '6px 8px' }}>{e.ipAddress || '—'}</td>
                  <td style={{ padding: '6px 8px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.userAgent || ''}>
                    {e.userAgent || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <span className="text-xs text-muted">{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

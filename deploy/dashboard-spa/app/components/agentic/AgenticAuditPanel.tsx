'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { fetchAgenticAudit, fetchAgenticDecisions } from '@/lib/guardian-api';
import { ProvenanceTimelinePanel } from './ProvenanceTimelinePanel';

type Props = { refreshKey?: number };

export function AgenticAuditPanel({ refreshKey = 0 }: Props) {
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof fetchAgenticAudit>>>(null);
  const [decisions, setDecisions] = useState<NonNullable<Awaited<ReturnType<typeof fetchAgenticDecisions>>>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, d] = await Promise.all([fetchAgenticAudit(100), fetchAgenticDecisions(50)]);
    setAudit(a);
    setDecisions(d ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const t = globalThis.setInterval(() => void load(), 10_000);
    return () => globalThis.clearInterval(t);
  }, [load]);

  if (loading && !audit) return <p className="hint p-6">Loading audit trail…</p>;

  return (
    <div className="agentic-panel space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Audit &amp; Decisions</h2>
          <p className="text-sm text-gray-500">Live MCP request audit (10s refresh) and agentic decision log</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Card className="p-3">
          <div className="text-gray-500">Total records</div>
          <div className="text-2xl font-bold">{audit?.stats.totalRecords ?? 0}</div>
        </Card>
        <Card className="p-3">
          <div className="text-gray-500">Blocked</div>
          <div className="text-2xl font-bold text-red-600">{audit?.stats.totalBlocked ?? 0}</div>
        </Card>
        <Card className="p-3">
          <div className="text-gray-500">Allowed</div>
          <div className="text-2xl font-bold">{audit?.stats.totalAllowed ?? 0}</div>
        </Card>
        <Card className="p-3">
          <div className="text-gray-500">Avg latency</div>
          <div className="text-2xl font-bold">{audit?.stats.averageLatencyMs ?? 0}ms</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="p-3 border-b border-gray-200 dark:border-gray-700 font-semibold">MCP request audit</div>
        {(audit?.records ?? []).length === 0 ? (
          <p className="p-6 text-center text-gray-400 text-sm">
            No MCP traffic recorded yet. Audit records appear as requests pass through the Guardian proxy.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-96">
            <table className="data-table w-full text-xs">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Tool</th>
                  <th>Latency</th>
                  <th>Status</th>
                  <th>Args</th>
                </tr>
              </thead>
              <tbody>
                {audit!.records.map((r) => (
                  <tr key={r.recordId}>
                    <td>{new Date(r.timestamp).toLocaleTimeString()}</td>
                    <td>{r.toolName ?? r.method}</td>
                    <td>{r.latencyMs}ms</td>
                    <td>
                      <Badge tone={r.blocked ? 'danger' : 'success'}>{r.blocked ? 'blocked' : 'ok'}</Badge>
                    </td>
                    <td className="font-mono truncate max-w-[200px]">{r.argsSummary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="p-3 border-b border-gray-200 dark:border-gray-700 font-semibold">Agentic decisions</div>
        {decisions.length === 0 ? (
          <p className="p-6 text-center text-gray-400 text-sm">No autonomous decisions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto max-h-64">
            <table className="data-table w-full text-xs">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Feature</th>
                  <th>Confidence</th>
                  <th>Outcome</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d!.decisionId}>
                    <td>{new Date(d!.timestamp).toLocaleTimeString()}</td>
                    <td>{d!.feature}</td>
                    <td>{(d!.confidence * 100).toFixed(0)}%</td>
                    <td>{d!.outcome ?? '—'}</td>
                    <td className="truncate max-w-[240px]">{d!.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ProvenanceTimelinePanel />
    </div>
  );
}

'use client';

import { Fragment, useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAgenticDashboard } from './useAgenticDashboard';
import { gradeColor } from './agentic-utils';
import { BiometricsPanel } from './BiometricsPanel';
import { ReputationPanel } from './ReputationPanel';
import { ZeroTrustPanel } from './ZeroTrustPanel';

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

type Props = { refreshKey?: number };

export function AgenticTrustPanel({ refreshKey = 0 }: Props) {
  const { data, loading } = useAgenticDashboard(refreshKey);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading && !data) return <p className="hint p-6">Loading trust data…</p>;

  const servers = data?.servers ?? [];

  return (
    <div className="agentic-panel space-y-4">
      <h2 className="text-xl font-bold">Trust &amp; Servers</h2>
      <p className="text-sm text-gray-500">Per-server Guardian trust scores computed from registry and live block metrics.</p>

      <Card className="overflow-hidden">
        <table className="data-table w-full text-sm">
          <thead>
            <tr>
              <th>Server</th>
              <th>Trust</th>
              <th>Calls</th>
              <th>Blocked</th>
              <th>Transport</th>
            </tr>
          </thead>
          <tbody>
            {servers.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-8">
                  No servers in registry — add guardian-configs/*.json
                </td>
              </tr>
            ) : (
              servers.map((s) => {
                const trust = s.trust;
                const open = expanded === s.name;
                return (
                  <Fragment key={s.name}>
                    <tr
                      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40"
                      onClick={() => setExpanded(open ? null : s.name)}
                    >
                      <td className="font-medium">{s.name}</td>
                      <td>
                        {trust ? (
                          <>
                            <span className="font-bold" style={{ color: gradeColor(trust.grade) }}>
                              {trust.grade}
                            </span>{' '}
                            <span className="text-gray-400">{trust.overallScore}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{s.metrics?.totalCalls ?? 0}</td>
                      <td>{s.metrics?.blocked ?? 0}</td>
                      <td>
                        <Badge tone="neutral">{s.transport}</Badge>
                      </td>
                    </tr>
                    {open && trust ? (
                      <tr key={`${s.name}-detail`}>
                        <td colSpan={5} className="bg-gray-50 dark:bg-gray-900/40 p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {trust.categories.map((c) => (
                              <div key={c.name}>
                                <div className="flex justify-between text-xs mb-1">
                                  <span>{c.name}</span>
                                  <span>{c.score}%</span>
                                </div>
                                <ProgressBar value={c.score} max={100} color={gradeColor(trust.grade)} />
                              </div>
                            ))}
                          </div>
                          {(trust.improvementActions ?? []).slice(0, 3).map((a) => (
                            <p key={a.action} className="text-xs text-gray-500 mt-2">
                              [{a.priority}] {a.action}
                            </p>
                          ))}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
      <ReputationPanel />
      <ZeroTrustPanel />
      <BiometricsPanel />
    </div>
  );
}

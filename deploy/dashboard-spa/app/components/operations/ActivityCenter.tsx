'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  fetchAuditHeatmap,
  fetchSwarmLatest,
  fetchSwarmStatus,
  fetchTrafficSummary,
  runSecuritySwarm,
  type AuditHeatmapResponse,
  type AuditResponse,
  type SwarmJobStatus,
  type TrafficSummary,
} from '@/lib/mastyf-ai-api';
import { CHART_AXIS, CHART_GRID, CHART_SERIES, classifyRule, RULE_CATEGORY_LABELS } from '@/lib/chartTheme';
import { Card } from '@/app/components/ui/Card';
import { Button } from '@/app/components/ui/Button';
import { Badge } from '@/app/components/ui/Badge';
import { KpiCard } from '@/app/components/ui/KpiCard';
import { EmptyState } from '@/app/components/ui/EmptyState';
import { WorkspaceSubNav } from '@/app/components/ui/WorkspaceSubNav';
import type { FlowTimelineEntry } from '@/lib/flow-types';

type Props = {
  view: 'realtime' | 'audit';
  onViewChange: (v: 'realtime' | 'audit') => void;
  roles?: string[];
  refreshKey: number;
  ws?: { entries: any[]; connected: boolean };
  swarmJobStatus?: any;
  onSwarmStatus?: (s: any) => void;
  onOpenThreats?: (view: string) => void;
  audit?: AuditResponse | null;
  auditAction?: string;
  auditServer?: string;
  onFilterChange?: (action: string, server: string) => void;
  onApplyFilters?: () => void;
  onFpReject?: (rule: string, pattern: string) => void;
  canMutate?: boolean;
};

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return '—'; }
}

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

const KIND_ICONS: Record<string, string> = {
  tool_call: '⚡',
  policy_block: '🚫',
  audit_event: '📋',
  flow_step: '→',
  system: '⚙',
  threat: '⚠',
  decision: '✓',
  error: '✗',
};

export function ActivityCenter({
  view,
  onViewChange,
  refreshKey,
  ws,
  swarmJobStatus,
  onSwarmStatus,
  onOpenThreats,
  audit,
  auditAction = '',
  auditServer = '',
  onFilterChange,
  onApplyFilters,
  onFpReject,
  canMutate,
}: Props) {
  const [swarmLatest, setSwarmLatest] = useState<any>(null);
  const [trafficSummary, setTrafficSummary] = useState<TrafficSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [heatmap, setHeatmap] = useState<AuditHeatmapResponse | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [eventPage, setEventPage] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const PAGE_SIZE = 25;

  const loadRealtime = useCallback(async () => {
    const [latest, traffic, st] = await Promise.all([
      fetchSwarmLatest().catch(() => null),
      fetchTrafficSummary().catch(() => null),
      fetchSwarmStatus().catch(() => null),
    ]);
    if (latest) setSwarmLatest(latest);
    if (traffic) setTrafficSummary(traffic);
    if (st) onSwarmStatus?.(st);
  }, [onSwarmStatus]);

  const loadHeatmap = useCallback(async () => {
    setHeatmap(await fetchAuditHeatmap(7).catch(() => null));
  }, []);

  useEffect(() => {
    if (view === 'realtime') { setEventPage(0); void loadRealtime(); }
  }, [view, refreshKey, loadRealtime]);

  useEffect(() => {
    if (view === 'audit') { setAuditPage(0); void loadHeatmap(); }
  }, [view, refreshKey, loadHeatmap]);

  const handleRunSwarm = async () => {
    setRunning(true);
    const res = await runSecuritySwarm({ full: false });
    if (res?.ok) {
      const st = await fetchSwarmStatus();
      if (st) onSwarmStatus?.(st);
    }
    setRunning(false);
  };

  const entries: FlowTimelineEntry[] = (ws?.entries ?? []) as FlowTimelineEntry[];
  const threatsFound = swarmLatest?.findings?.length ?? 0;
  const swarmState: SwarmJobStatus | null = swarmJobStatus as SwarmJobStatus | null;
  const swarmStateLabel = swarmState?.state ?? 'idle';
  const swarmBadgeVariant = swarmStateLabel === 'running' ? 'live' : swarmStateLabel === 'done' ? 'success' : swarmStateLabel === 'failed' ? 'danger' : 'neutral';

  /* ── Group live entries by kind ── */
  const groupedEntries = useMemo(() => {
    const groups: Record<string, FlowTimelineEntry[]> = {};
    for (const e of entries.slice(eventPage * PAGE_SIZE, (eventPage + 1) * PAGE_SIZE)) {
      const key = e.kind || 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    }
    return groups;
  }, [entries, eventPage]);

  const groupOrder = ['tool_call', 'policy_block', 'audit_event', 'flow_step', 'threat', 'decision', 'error', 'system', 'other'];

  const heatmapChart = (heatmap?.cells ?? []).slice(0, 20).map(c => ({
    label: `${c.rule.slice(0, 14)} · ${c.tool.slice(0, 14)}`,
    count: c.count,
  }));

  const events = audit?.events || [];

  const subtabs = [
    { id: 'realtime' as const, label: 'Event Explorer' },
    { id: 'audit' as const, label: 'Audit Trail' },
  ];

  return (
    <section aria-label="Operational Activity Center">
      <div className="page-header">
        <div>
          <h1>Activity Center</h1>
          <p>Unified operational view — real-time agent activity and audit trail</p>
        </div>
      </div>

      <WorkspaceSubNav tabs={subtabs} active={view} onChange={onViewChange} />

      {view === 'realtime' && (
        <>
          <div className="kpi-grid">
            <KpiCard label="Total Events" value={entries.length.toLocaleString()} accent="info" />
            <KpiCard
              label="Live Stream"
              value={ws?.connected ? 'Connected' : 'Disconnected'}
              accent={ws?.connected ? 'success' : 'danger'}
              secondary={`${groupedEntries.tool_call?.length || 0} active tool calls`}
            />
            <KpiCard
              label="Swarm Status"
              value={swarmStateLabel}
              accent={swarmBadgeVariant === 'danger' ? 'danger' : 'info'}
              secondary={swarmLatest?.findings ? `${swarmLatest.findings.length} findings` : undefined}
            />
            <KpiCard label="Threats Found" value={threatsFound.toLocaleString()} accent={threatsFound > 0 ? 'danger' : 'neutral'} />
          </div>

          <div className="grid grid-12" style={{ marginBottom: 'var(--space-5)' }}>
            <div className="col-span-8">
              <Card title="Event Explorer" subtitle={`${entries.length} events grouped by type`}>
                {entries.length === 0 ? (
                  <EmptyState title="No activity" message="Waiting for agent events from WebSocket" />
                ) : (
                  <div className="activity-event-list" style={{ maxHeight: 480, overflowY: 'auto' }}>
                    {groupOrder.map((kind) => {
                      const kindEntries = groupedEntries[kind];
                      if (!kindEntries?.length) return null;
                      return (
                        <div key={kind} className="activity-event-group">
                          <button
                            className="activity-event-group-header"
                            onClick={() => setExpandedEvent(expandedEvent === kind ? null : kind)}
                          >
                            <span className="activity-kind-icon">{KIND_ICONS[kind] || '○'}</span>
                            <span className="activity-kind-label">{kind.replace(/_/g, ' ')}</span>
                            <span className="badge badge-neutral">{kindEntries.length}</span>
                            <span className="activity-expand">{expandedEvent === kind ? '▾' : '▸'}</span>
                          </button>
                          {expandedEvent === kind && (
                            <div className="activity-event-children">
                              {kindEntries.map((e) => (
                                <div key={e.id} className="activity-event-item">
                                  <span className={`activity-event-severity severity-${e.severity || 'info'}`} />
                                  <div className="activity-event-body">
                                    <div className="activity-event-head">
                                      <span className="activity-event-title">{e.title}</span>
                                      <span className="activity-event-time mono">{formatTime(e.timestamp)}</span>
                                    </div>
                                    <div className="activity-event-summary">{e.summary}</div>
                                    <div className="activity-event-meta">
                                      {e.serverName && <Badge variant="neutral">{e.serverName}</Badge>}
                                      {e.toolName && <Badge variant="info">{e.toolName}</Badge>}
                                      <Badge variant={e.severity === 'error' || (e as any).severity === 'critical' ? 'danger' : e.severity === 'warn' ? 'warning' : 'neutral'}>
                                        {(e as any).severity || e.severity}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="pagination-bar">
                  <button className="btn btn-ghost btn-sm" disabled={eventPage === 0} onClick={() => setEventPage(p => p - 1)}>‹ Prev</button>
                  <span className="pagination-info">{eventPage * PAGE_SIZE + 1}–{Math.min((eventPage + 1) * PAGE_SIZE, entries.length)} of {entries.length}</span>
                  <button className="btn btn-ghost btn-sm" disabled={(eventPage + 1) * PAGE_SIZE >= entries.length} onClick={() => setEventPage(p => p + 1)}>Next ›</button>
                </div>
              </Card>
            </div>
            <div className="col-span-4">
              <Card title="Swarm Controls" subtitle="On-demand security analysis" className="mb-4">
                <div className="flex items-center gap-3">
                  <Button variant="primary" loading={running} onClick={handleRunSwarm}>
                    {running ? 'Analyzing…' : 'Run Analysis'}
                  </Button>
                  {swarmState && (
                    <div className="text-sm text-muted">
                      {swarmState.state === 'running' && `Phase: ${swarmState.phaseLabel} (${swarmState.progressPct}%)`}
                      {swarmState.state === 'done' && 'Last analysis completed'}
                      {swarmState.state === 'failed' && `Failed: ${swarmState.error || 'unknown'}`}
                      {swarmState.state === 'idle' && 'Ready'}
                    </div>
                  )}
                </div>
                {swarmLatest?.findings && swarmLatest.findings.length > 0 && (
                  <div className="mt-3">
                    <p className="font-semibold text-sm mb-1">Latest findings</p>
                    {swarmLatest.findings.slice(0, 5).map((f: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm mb-1">
                        {f.severity === 'critical' || f.severity === 'high' ? (
                          <span className="severity-dot" style={{ background: 'var(--danger)' }} />
                        ) : (
                          <span className="severity-dot" style={{ background: 'var(--warning)' }} />
                        )}
                        <span className="truncate">{f.source}: {f.summary}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card title="Traffic Summary" subtitle="Server call distribution">
                {trafficSummary?.hasData ? (
                  <div>
                    <div className="text-sm text-muted mb-2">
                      Total calls: {trafficSummary.totalCalls?.toLocaleString() ?? '—'} · Blocked: {trafficSummary.totalBlocked?.toLocaleString() ?? '—'}
                    </div>
                    {(trafficSummary.servers ?? []).slice(0, 6).map((s: any) => (
                      <div key={s.serverName} className="flex justify-between text-sm py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <span className="truncate">{s.serverName}</span>
                        <span className="font-medium mono">{s.calls} calls · {s.blocked} blocked</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No traffic data" message="Waiting for MCP server activity" />
                )}
              </Card>

              {onOpenThreats && threatsFound > 0 && (
                <div className="mt-4">
                  <Button variant="danger" onClick={() => onOpenThreats('overview')}>
                    View {threatsFound} threats
                  </Button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {view === 'audit' && (
        <>
          <div className="kpi-grid">
            <KpiCard label="Total Events" value={audit?.total?.toLocaleString() ?? '—'} accent="info" />
            <KpiCard label="Blocked" value={audit?.blocked?.toLocaleString() ?? '—'} accent="danger" />
            <KpiCard label="Passed" value={audit?.passed?.toLocaleString() ?? '—'} accent="success" />
            <KpiCard
              label="Flagged"
              value={(audit?.flagged ?? audit?.semanticAudit?.flagged ?? 0).toLocaleString()}
              accent="warning"
            />
          </div>

          <Card title="Filters">
            <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
              <div className="search-bar" style={{ maxWidth: 200 }}>
                <select
                  className="input select"
                  value={auditAction}
                  onChange={(e) => onFilterChange?.(e.target.value, auditServer)}
                  aria-label="Filter by action"
                >
                  <option value="">All actions</option>
                  <option value="block">Block</option>
                  <option value="pass">Pass</option>
                  <option value="flag">Flag</option>
                </select>
              </div>
              <div className="search-bar" style={{ flex: 1, maxWidth: 280 }}>
                <span className="search-bar-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="Search by server name…"
                  value={auditServer}
                  onChange={(e) => onFilterChange?.(auditAction, e.target.value)}
                  className="input"
                  style={{ paddingLeft: 30 }}
                />
              </div>
              <Button variant="primary" size="sm" onClick={onApplyFilters}>
                Apply
              </Button>
            </div>
          </Card>

          <div className="grid grid-12" style={{ marginBottom: 'var(--space-5)' }}>
            <div className="col-span-7">
              <Card title="Activity Heatmap" subtitle="Day × hour event density">
                {(() => {
                  const matrix = heatmap?.activity;
                  if (!matrix?.days?.length) return <EmptyState title="No heatmap data" message="Insufficient event data for the selected window" />;
                  const max = matrix.maxCount || 1;
                  return (
                    <div>
                      {matrix.days.map((day: string, di: number) => (
                        <div key={di} className="flex items-center gap-1 mb-1">
                          <span className="text-xs text-muted mono" style={{ width: 32 }}>{day}</span>
                          {matrix.hours.map((h: number, hi: number) => {
                            const count = matrix.matrix[di]?.[hi] ?? 0;
                            const level = count === 0 ? 0 : count / max > 0.5 ? 4 : count / max > 0.25 ? 3 : count / max > 0.1 ? 2 : 1;
                            return (
                              <span
                                key={hi}
                                className={`heatmap-cell level-${level}`}
                                title={`${day} ${h}:00 — ${count} events`}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </Card>
            </div>
            <div className="col-span-5">
              <Card title="Top Block Patterns" subtitle="Rule × tool combinations">
                {heatmapChart.length === 0 ? (
                  <EmptyState title="No block data" message="No blocked events recorded" />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={heatmapChart} layout="vertical">
                      <CartesianGrid {...CHART_GRID} />
                      <XAxis type="number" {...CHART_AXIS} />
                      <YAxis type="category" dataKey="label" width={140} {...CHART_AXIS} />
                      <Tooltip />
                      <Bar dataKey="count" fill={CHART_SERIES.block} name="Blocks" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>
          </div>

          <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Server</th>
                  <th>Tool</th>
                  <th>Action</th>
                  <th>Category</th>
                  <th>Rule</th>
                  <th>Cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState title="No events" message="No audit events match the current filters" />
                    </td>
                  </tr>
                ) : (
                  events.slice(auditPage * PAGE_SIZE, (auditPage + 1) * PAGE_SIZE).map((e: any, i: number) => {
                    const cat = e.action === 'block' && e.rule ? classifyRule(e.rule) : null;
                    const globalIdx = auditPage * PAGE_SIZE + i;
                    const isExpanded = expandedRow === globalIdx;
                    return (
                      <>
                        <tr
                          key={`${e.timestamp}-${globalIdx}`}
                          className={isExpanded ? 'row-active' : e.action === 'block' ? 'row-warning' : ''}
                          onClick={() => setExpandedRow(isExpanded ? null : globalIdx)}
                        >
                          <td className="mono text-sm">{e.timestamp?.slice(11, 19) || '—'}</td>
                          <td>
                            <span className="truncate" style={{ maxWidth: 120, display: 'inline-block' }}>{e.server_name || '—'}</span>
                          </td>
                          <td className="font-medium">{e.tool_name || '—'}</td>
                          <td>
                            <Badge variant={e.action === 'block' ? 'danger' : e.action === 'flag' ? 'warning' : 'success'}>
                              {e.action}
                            </Badge>
                          </td>
                          <td>
                            {e.action !== 'block' || !e.rule ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <span className="text-sm" style={{ color: cat === 'security' ? CHART_SERIES.block : CHART_SERIES.neutral }}>
                                {cat ? RULE_CATEGORY_LABELS[cat] : '—'}
                              </span>
                            )}
                          </td>
                          <td className="mono text-xs">{e.rule || '—'}</td>
                          <td className="mono text-sm">{e.cost_usd != null ? `$${e.cost_usd.toFixed(4)}` : '—'}</td>
                          <td>
                            <button
                              className="btn btn-ghost btn-icon-sm"
                              onClick={(ev) => { ev.stopPropagation(); setExpandedRow(isExpanded ? null : i); }}
                              aria-label="Toggle details"
                            >
                              {isExpanded ? '▾' : '▸'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${e.timestamp}-${i}-expanded`} className="row-detail">
                            <td colSpan={8}>
                              <div className="p-4" style={{ background: 'var(--bg-subtle)' }}>
                                <div className="grid grid-2" style={{ gap: 'var(--space-4)' }}>
                                  <div>
                                    <p className="text-xs text-muted mb-1">Full timestamp</p>
                                    <p className="text-sm">{e.timestamp || '—'}</p>
                                    {e.model && (
                                      <>
                                        <p className="text-xs text-muted mt-2 mb-1">Model</p>
                                        <p className="text-sm">{e.model}</p>
                                      </>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-xs text-muted mb-1">Reason</p>
                                    <p className="text-sm">{e.reason || 'No reason provided'}</p>
                                    {e.action === 'block' && e.rule && canMutate && (
                                      <div className="mt-3">
                                        <Button
                                          size="sm"
                                          variant="danger"
                                          onClick={(ev) => { ev.stopPropagation(); onFpReject?.(e.rule || '', e.reason || e.tool_name || ''); }}
                                        >
                                          Report false positive
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination-bar">
            <button className="btn btn-ghost btn-sm" disabled={auditPage === 0} onClick={() => setAuditPage(p => p - 1)}>‹ Prev</button>
            <span className="pagination-info">{auditPage * PAGE_SIZE + 1}–{Math.min((auditPage + 1) * PAGE_SIZE, events.length)} of {events.length}</span>
            <button className="btn btn-ghost btn-sm" disabled={(auditPage + 1) * PAGE_SIZE >= events.length} onClick={() => setAuditPage(p => p + 1)}>Next ›</button>
          </div>
        </>
      )}
    </section>
  );
}

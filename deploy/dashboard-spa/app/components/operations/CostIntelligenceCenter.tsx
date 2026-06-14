'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchCost,
  fetchCostBreakdown,
  fetchCostRecommendations,
  type CostBreakdownResponse,
  type CostRecommendation,
  type CostResponse,
} from '@/lib/mastyf-ai-api';
import { formatUsd } from '@/lib/chartTheme';
import { useCurrentWindowDays } from '@/app/components/dashboard/DashboardWindowContext';
import { Badge } from '@/app/components/ui/Badge';
import { Button } from '@/app/components/ui/Button';
import { Card } from '@/app/components/ui/Card';
import { EmptyState } from '@/app/components/ui/EmptyState';
import { KpiCard } from '@/app/components/ui/KpiCard';
import { WorkspaceSubNav } from '@/app/components/ui/WorkspaceSubNav';

type CostView = 'overview' | 'breakdown' | 'budgets';

type Props = {
  view: CostView;
  onViewChange: (v: CostView) => void;
  refreshKey: number;
  initialCost?: CostResponse | null;
};

type ServerEntry = { name: string; cost: number; tokens: number };
type ToolEntry = { server: string; tool: string; calls: number; costUsd: number };

type SortKey = 'server' | 'tool' | 'calls' | 'costUsd';
type SortDir = 'asc' | 'desc';

function gaugeColor(pct: number): string {
  if (pct > 90) return 'var(--danger)';
  if (pct > 70) return 'var(--warning)';
  return 'var(--success)';
}

function formatNumber(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function inferSeverity(message: string): 'danger' | 'warning' | 'info' {
  const m = message.toLowerCase();
  if (m.includes('critical') || m.includes('exceed')) return 'danger';
  if (m.includes('warn') || m.includes('approaching') || m.includes('high')) return 'warning';
  return 'info';
}

function OverviewView({ cost, tools, recommendations, loading }: {
  cost: CostResponse | null;
  tools: ToolEntry[];
  recommendations: CostRecommendation[];
  loading: boolean;
}) {
  const budgetPct = useMemo(() => {
    if (cost?.budgetUsd && cost.totalCost != null && cost.budgetUsd > 0) {
      return Math.min(100, (cost.totalCost / cost.budgetUsd) * 100);
    }
    return null;
  }, [cost?.budgetUsd, cost?.totalCost]);

  const servers = useMemo(() => {
    if (!cost?.serverReports) return [];
    return [...cost.serverReports]
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  }, [cost?.serverReports]);

  const maxServerCost = useMemo(() => {
    if (servers.length === 0) return 0;
    return Math.max(...servers.map((s) => s.cost ?? 0));
  }, [servers]);

  const topTools = useMemo(() => {
    return [...tools]
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 10);
  }, [tools]);

  const maxToolCost = useMemo(() => {
    if (topTools.length === 0) return 0;
    return Math.max(...topTools.map((t) => t.costUsd));
  }, [topTools]);

  if (loading && !cost) {
    return <div className="cost-intel-loading">Loading cost data…</div>;
  }

  if (!cost) {
    return (
      <Card title="AI Usage & Cost Intelligence">
        <EmptyState
          title="No cost data available"
          message="Connect your proxy history database and route MCP traffic to see cost intelligence."
        />
      </Card>
    );
  }

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Total Spend" value={cost.totalCost != null ? formatUsd(cost.totalCost) : '—'} accent="info" secondary={`${cost.windowDays ?? 7}d window`} />
        <KpiCard
          label="Burn Rate"
          value={cost.burnRatePerHour != null ? `${formatUsd(cost.burnRatePerHour)}/hr` : '—'}
          accent="neutral"
          secondary={cost.projectedMonthly != null ? `Proj. monthly ${formatUsd(cost.projectedMonthly)}` : undefined}
        />
        <KpiCard
          label="Projected Monthly"
          value={cost.projectedMonthly != null ? formatUsd(cost.projectedMonthly) : '—'}
          accent="warning"
        />
        <KpiCard label="Pricing Model" value={cost.pricingModel ?? '—'} accent="neutral" />
      </div>

      {budgetPct != null && cost.budgetUsd != null ? (
        <Card title="Budget Utilization" subtitle={`${cost.budgetUsd.toFixed(2)} budget`}>
          <div style={{ marginBottom: 8 }}>
            <strong>{budgetPct.toFixed(1)}% used</strong>
          </div>
          <div style={{ background: 'var(--bg-muted)', borderRadius: 'var(--radius-lg)', height: 24, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, budgetPct)}%`, height: '100%', background: gaugeColor(budgetPct), borderRadius: 'var(--radius-lg)', transition: 'width 500ms ease' }} />
          </div>
        </Card>
      ) : null}

      {(cost.budgetAlerts ?? []).length > 0 ? (
        <Card title="Budget Alerts">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(cost.budgetAlerts ?? []).map((alert, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge variant={inferSeverity(alert)}>{inferSeverity(alert).toUpperCase()}</Badge>
                <span>{alert}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {servers.length > 0 ? (
        <Card title="Cost by Server" subtitle="Horizontal bars show relative cost share">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {servers.map((srv) => (
              <div key={srv.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 'var(--font-size-sm)' }}>
                  <span>{srv.name}</span>
                  <span>{formatUsd(srv.cost)}</span>
                </div>
                <div style={{ background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', height: 16, overflow: 'hidden' }}>
                  <div style={{ width: `${maxServerCost > 0 ? (srv.cost / maxServerCost) * 100 : 0}%`, height: '100%', background: 'var(--accent)', borderRadius: 'var(--radius-sm)', transition: 'width 500ms ease' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {topTools.length > 0 ? (
        <Card title="Top Tools by Cost" subtitle="Highest cost drivers">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topTools.map((t) => {
              const label = `${t.server}:${t.tool}`.slice(0, 32);
              return (
                <div key={label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 'var(--font-size-sm)' }}>
                    <span>{label}</span>
                    <span>{formatUsd(t.costUsd)}</span>
                  </div>
                  <div style={{ background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', height: 16, overflow: 'hidden' }}>
                    <div style={{ width: `${maxToolCost > 0 ? (t.costUsd / maxToolCost) * 100 : 0}%`, height: '100%', background: 'var(--accent)', borderRadius: 'var(--radius-sm)', transition: 'width 500ms ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {recommendations.length > 0 ? (
        <Card title="Optimization Recommendations" subtitle="Cost-saving opportunities">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {recommendations.map((rec) => (
              <div key={rec.ruleName} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <strong>{rec.ruleName}</strong>
                  <Badge variant="success">~{formatUsd(rec.estimatedSavingsUsd)} saved</Badge>
                </div>
                <p style={{ margin: 0, fontSize: 'var(--font-size-sm)' }}>{rec.description || rec.reason}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

function BreakdownView({ tools, loading }: { tools: ToolEntry[]; loading: boolean }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('costUsd');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return tools;
    const q = search.toLowerCase();
    return tools.filter(
      (t) => t.server.toLowerCase().includes(q) || t.tool.toLowerCase().includes(q),
    );
  }, [tools, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'server': return a.server.localeCompare(b.server) * dir;
        case 'tool': return a.tool.localeCompare(b.tool) * dir;
        case 'calls': return (a.calls - b.calls) * dir;
        case 'costUsd': return (a.costUsd - b.costUsd) * dir;
        default: return 0;
      }
    });
  }, [filtered, sortKey, sortDir]);

  const summary = useMemo(() => {
    const uniqueServers = new Set(tools.map((t) => t.server));
    const uniqueTools = new Set(tools.map((t) => t.tool));
    const totalCost = tools.reduce((sum, t) => sum + t.costUsd, 0);
    return { servers: uniqueServers.size, tools: uniqueTools.size, totalCost };
  }, [tools]);

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  if (loading && tools.length === 0) {
    return <div className="cost-intel-loading">Loading breakdown…</div>;
  }

  if (tools.length === 0) {
    return (
      <Card title="Cost Breakdown">
        <EmptyState title="No breakdown data" message="No tool-level cost data available for this window." />
      </Card>
    );
  }

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Total Servers" value={summary.servers} accent="info" />
        <KpiCard label="Total Tools" value={summary.tools} accent="neutral" />
        <KpiCard label="Total Cost" value={formatUsd(summary.totalCost)} accent="warning" />
        <KpiCard label="Window" value={sorted.length > 0 ? `${sorted.length} entries` : '—'} accent="info" />
      </div>

      <Card title="Tool-Level Cost Breakdown" subtitle={`${sorted.length} of ${tools.length} entries`}>
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Search by server or tool…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 'var(--font-size-sm)',
            }}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="cost-intel-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th onClick={() => toggleSort('server')} style={{ cursor: 'pointer', textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--border)' }}>
                  Server{sortIndicator('server')}
                </th>
                <th onClick={() => toggleSort('tool')} style={{ cursor: 'pointer', textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--border)' }}>
                  Tool{sortIndicator('tool')}
                </th>
                <th onClick={() => toggleSort('calls')} style={{ cursor: 'pointer', textAlign: 'right', padding: '8px 12px', borderBottom: '2px solid var(--border)' }}>
                  Calls{sortIndicator('calls')}
                </th>
                <th onClick={() => toggleSort('costUsd')} style={{ cursor: 'pointer', textAlign: 'right', padding: '8px 12px', borderBottom: '2px solid var(--border)' }}>
                  Cost (USD){sortIndicator('costUsd')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={`${row.server}:${row.tool}:${i}`}>
                  <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>{row.server}</td>
                  <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>{row.tool}</td>
                  <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>{formatNumber(row.calls)}</td>
                  <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>{formatUsd(row.costUsd)}</td>
                </tr>
              ))}
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No matching entries.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function BudgetsView({ cost, loading }: { cost: CostResponse | null; loading: boolean }) {
  const budgetPct = useMemo(() => {
    if (cost?.budgetUsd && cost.totalCost != null && cost.budgetUsd > 0) {
      return Math.min(100, (cost.totalCost / cost.budgetUsd) * 100);
    }
    return null;
  }, [cost?.budgetUsd, cost?.totalCost]);

  const exceeds = budgetPct != null && budgetPct >= 100;

  if (loading && !cost) {
    return <div className="cost-intel-loading">Loading budget data…</div>;
  }

  if (!cost) {
    return (
      <Card title="Budgets">
        <EmptyState
          title="No budget data"
          message="Connect proxy history with pricing to see budget utilization."
        />
      </Card>
    );
  }

  return (
    <>
      {budgetPct != null && cost.budgetUsd != null ? (
        <Card
          title="Budget Usage"
          subtitle={`${formatUsd(cost.budgetUsd)} budget`}
        >
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>
                {exceeds ? 'Budget exceeded!' : `${budgetPct.toFixed(1)}% used`}
              </strong>
              <span>{formatUsd(cost.totalCost ?? 0)} / {formatUsd(cost.budgetUsd)}</span>
            </div>
            <div style={{ background: 'var(--bg-muted)', borderRadius: 'var(--radius-lg)', height: 32, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, budgetPct)}%`,
                  height: '100%',
                  background: gaugeColor(budgetPct),
                  borderRadius: 'var(--radius-lg)',
                  transition: 'width 500ms ease',
                }}
              />
            </div>
          </div>
        </Card>
      ) : (
        <Card title="Budget Usage">
          <EmptyState title="No budget configured" message="Set a budget via proxy configuration to track spending limits." />
        </Card>
      )}

      <div className="kpi-grid">
        <KpiCard
          label="Current Spend"
          value={cost.totalCost != null ? formatUsd(cost.totalCost) : '—'}
          accent="info"
        />
        <KpiCard
          label="Projected Monthly"
          value={cost.projectedMonthly != null ? formatUsd(cost.projectedMonthly) : '—'}
          accent="warning"
        />
        <KpiCard
          label="Budget"
          value={cost.budgetUsd != null ? formatUsd(cost.budgetUsd) : '—'}
          accent="neutral"
        />
        {cost.projectedMonthly != null && cost.budgetUsd != null && cost.budgetUsd > 0 ? (
          <KpiCard
            label="Projected vs Budget"
            value={`${((cost.projectedMonthly / cost.budgetUsd) * 100).toFixed(1)}%`}
            accent={cost.projectedMonthly > cost.budgetUsd ? 'danger' : cost.projectedMonthly > cost.budgetUsd * 0.8 ? 'warning' : 'info'}
          />
        ) : null}
      </div>

      {(cost.budgetAlerts ?? []).length > 0 ? (
        <Card title="Budget Alerts">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(cost.budgetAlerts ?? []).map((alert, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <Badge variant={inferSeverity(alert)}>{inferSeverity(alert).toUpperCase()}</Badge>
                <span>{alert}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="Budget Management" subtitle="Configuration & controls">
        <EmptyState
          title="Budget management coming soon"
          message="Automated budget alerts, threshold policies, and spend caps will be available in a future release."
        />
      </Card>
    </>
  );
}

export function CostIntelligenceCenter({ view, onViewChange, refreshKey, initialCost = null }: Props) {
  const { windowDays } = useCurrentWindowDays();
  const [cost, setCost] = useState<CostResponse | null>(initialCost);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [recommendations, setRecommendations] = useState<CostRecommendation[]>([]);
  const [loading, setLoading] = useState(!initialCost);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, b, rec] = await Promise.all([
        fetchCost(windowDays),
        fetchCostBreakdown(windowDays),
        fetchCostRecommendations(windowDays),
      ]);
      if (c) setCost(c);
      if (b?.tools) setTools(b.tools);
      if (rec?.recommendations) setRecommendations(rec.recommendations);
    } catch {
      /* silent fail — empty state handles missing data */
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const VIEW_TABS = [
    { id: 'overview' as const, label: 'Cost Overview' },
    { id: 'breakdown' as const, label: 'Breakdown' },
    { id: 'budgets' as const, label: 'Budgets' },
  ];

  return (
    <section aria-label="Cost Intelligence Center">
      <div className="page-header">
        <div>
          <h1>AI Cost Intelligence</h1>
          <p>Usage tracking, cost attribution, and budget management</p>
        </div>
      </div>

      <WorkspaceSubNav tabs={VIEW_TABS} active={view} onChange={onViewChange} />

      {view === 'overview' ? (
        <OverviewView cost={cost} tools={tools} recommendations={recommendations} loading={loading} />
      ) : view === 'breakdown' ? (
        <BreakdownView tools={tools} loading={loading} />
      ) : (
        <BudgetsView cost={cost} loading={loading} />
      )}
    </section>
  );
}

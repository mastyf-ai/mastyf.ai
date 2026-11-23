'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  fetchAnalyticsSummary,
  type AnalyticsSummaryResponse,
} from '@/lib/mastyf-ai-api';
import { useDashboardWindow } from '../dashboard/DashboardWindowContext';
import { formatWindowSubtitle } from '@/lib/format-dashboard-window';
import {
  isApiDataUnavailable,
  unavailableKpiSecondary,
  unavailableKpiValue,
} from '@/lib/dashboard-fetch-utils';
import { computeDriftMetrics } from '@/lib/advanced-analytics';
import {
  CHART_AXIS,
  CHART_COLORS,
  CHART_GRID,
  CHART_SERIES,
  CHART_TOOLTIP_STYLE,
  formatUsd,
} from '@/lib/chartTheme';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { KpiCard } from '../ui/KpiCard';
import { EmptyState } from '../ui/EmptyState';

const PROVIDER_COLORS: Record<string, string> = {
  openai: CHART_SERIES.allow,
  anthropic: CHART_SERIES.warn,
  google: CHART_SERIES.accent,
  other: CHART_SERIES.neutral,
};

type Props = {
  refreshKey?: number;
  wsConnected?: boolean;
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function bucketLabel(bucket: string, windowParam: string): string {
  const d = new Date(bucket);
  if (Number.isNaN(d.getTime())) return bucket;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: windowParam === '1h' || windowParam === '12h' || windowParam === '24h' ? 'numeric' : undefined,
  });
}

export function AnalyticsDashboardPanel({ refreshKey = 0, wsConnected = false }: Props) {
  const { windowParam } = useDashboardWindow();
  const [data, setData] = useState<AnalyticsSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const summary = await fetchAnalyticsSummary(windowParam);
    setData(summary);
    setLoading(false);
  }, [windowParam]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const trafficData = useMemo(
    () =>
      (data?.trafficSeries ?? []).map((p) => ({
        label: bucketLabel(p.bucket, windowParam),
        requests: p.requests,
        blocked: p.blocked,
        passed: Math.max(0, p.requests - p.blocked),
      })),
    [data?.trafficSeries, windowParam],
  );

  const costData = data?.costSeries ?? [];
  const latencyData = useMemo(
    () =>
      (data?.latencySeries ?? []).map((p) => ({
        label: bucketLabel(p.bucket, windowParam),
        p50: p.p50Ms,
        p95: p.p95Ms,
      })),
    [data?.latencySeries, windowParam],
  );
  const errorRateData = useMemo(
    () =>
      (data?.errorRateSeries ?? []).map((p) => ({
        label: bucketLabel(p.bucket, windowParam),
        errorRatePct: p.errorRatePct,
        blocked: p.blocked,
        requests: p.requests,
      })),
    [data?.errorRateSeries, windowParam],
  );
  const modelData = data?.modelUsage ?? [];
  const providerCosts = data?.providerCosts ?? [];
  const totalCost = costData.reduce((s, c) => s + c.costUsd, 0);
  const maxProviderCost = Math.max(...providerCosts.map((p) => p.costUsd), 0);
  const windowSubtitle = formatWindowSubtitle(windowParam);
  const drift = computeDriftMetrics(data);
  const unavailable = isApiDataUnavailable(data);


  if (loading && !data) {
    return <p className="text-sm text-muted">Loading analytics…</p>;
  }

  if (!data || unavailable) {
    return (
      <Card title="Usage Analytics">
        <EmptyState
          title="Analytics unavailable"
          message={data?.error || data?.emptyReason || 'Connect the proxy history database to view usage analytics.'}
        />
      </Card>
    );
  }

  return (
    <>
      <div className="kpi-grid">
        <KpiCard
          label="Total Requests"
          value={unavailableKpiValue(data, data.totalRequests ?? 0)}
          accent="info"
          secondary={unavailableKpiSecondary(data, windowSubtitle)}
        />
        <KpiCard
          label="Avg Latency"
          value={data.avgLatencyMs != null ? `${data.avgLatencyMs} ms` : '—'}
          accent="neutral"
        />
        <KpiCard
          label="Error Rate"
          value={data.errorRatePct != null ? `${data.errorRatePct}%` : '—'}
          accent={data.errorRatePct != null && data.errorRatePct > 5 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Tokens Used"
          value={formatTokens(data.tokensUsed ?? 0)}
          accent="info"
        />
        <KpiCard
          label="Data Feed"
          value={wsConnected ? 'Live' : 'Polling'}
          accent={wsConnected ? 'success' : 'warning'}
          secondary={data.generatedAt ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : undefined}
        />
      </div>

      {data.emptyReason ? (
        <div className="banner banner-warning" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="banner-content">{data.emptyReason}</div>
        </div>
      ) : null}

      <div className="grid grid-12" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="col-span-8">
          <Card title="Traffic Volume" subtitle={windowSubtitle}>
            {trafficData.length === 0 ? (
              <EmptyState title="No traffic" message="No requests recorded in this window" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={trafficData}>
                  <defs>
                    <linearGradient id="analyticsRequestsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_SERIES.accent} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={CHART_SERIES.accent} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="analyticsBlockedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_SERIES.block} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={CHART_SERIES.block} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" {...CHART_AXIS} interval="preserveStartEnd" />
                  <YAxis {...CHART_AXIS} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="passed"
                    name="Passed"
                    stroke={CHART_SERIES.allow}
                    fill="url(#analyticsRequestsFill)"
                    strokeWidth={2}
                    stackId="traffic"
                  />
                  <Area
                    type="monotone"
                    dataKey="blocked"
                    name="Blocked"
                    stroke={CHART_SERIES.block}
                    fill="url(#analyticsBlockedFill)"
                    strokeWidth={2}
                    stackId="traffic"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card
            title="Cost Over Time"
            subtitle={
              totalCost > 0
                ? `${formatUsd(totalCost)} total${data.budgetUtilizationPct != null ? ` · ${Math.round(data.budgetUtilizationPct)}% of budget` : ''}`
                : windowSubtitle
            }
            style={{ marginTop: 'var(--space-4)' }}
          >
            {costData.length === 0 ? (
              <EmptyState title="No cost data" message="No priced calls in this window" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={costData}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(v: number) => [formatUsd(v), 'Cost']}
                  />
                  <Bar dataKey="costUsd" fill={CHART_SERIES.cost} radius={[4, 4, 0, 0]} name="Cost" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card
            title="Latency Percentiles"
            subtitle="p50 vs p95 over time"
            style={{ marginTop: 'var(--space-4)' }}
          >
            {latencyData.length === 0 ? (
              <EmptyState title="No latency data" message={data.meta?.emptyReason ?? 'No duration metrics in this window'} />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={latencyData}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" {...CHART_AXIS} interval="preserveStartEnd" />
                  <YAxis {...CHART_AXIS} unit=" ms" />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Legend />
                  <Line type="monotone" dataKey="p50" stroke={CHART_SERIES.allow} strokeWidth={2} dot={false} name="p50" />
                  <Line type="monotone" dataKey="p95" stroke={CHART_SERIES.warn} strokeWidth={2} dot={false} name="p95" />
                </LineChart>
              </ResponsiveContainer>
            )}
            {data.meta?.generatedAt ? (
              <p className="text-xs text-muted" style={{ marginTop: 'var(--space-2)' }}>
                {data.meta.recordCount} records · {windowSubtitle}
                {data.meta.sparse ? ' · sparse window' : ''}
              </p>
            ) : null}
          </Card>

          <Card
            title="Error Rate Trend"
            subtitle="Blocked requests as % of traffic per bucket"
            style={{ marginTop: 'var(--space-4)' }}
          >
            {errorRateData.length === 0 ? (
              <EmptyState title="No error-rate data" message={data.meta?.emptyReason ?? 'No requests in this window'} />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={errorRateData}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" {...CHART_AXIS} interval="preserveStartEnd" />
                  <YAxis {...CHART_AXIS} unit="%" />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="errorRatePct" stroke={CHART_SERIES.block} fill={CHART_SERIES.block} fillOpacity={0.35} name="Error %" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Model Usage" subtitle="Call share by model" style={{ marginTop: 'var(--space-4)' }}>
            {modelData.length === 0 ? (
              <EmptyState title="No model breakdown" message="Model metadata was not recorded for this window" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Calls</th>
                      <th>Tokens</th>
                      <th>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelData.map((m, i) => (
                      <tr key={m.model}>
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: CHART_COLORS[i % CHART_COLORS.length],
                              marginRight: 8,
                            }}
                          />
                          {m.label}
                        </td>
                        <td>{m.calls.toLocaleString()}</td>
                        <td>{formatTokens(m.tokens)}</td>
                        <td>{m.pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="col-span-4">
          <Card title="Model Mix" subtitle="Share of calls by model">
            {modelData.length === 0 ? (
              <EmptyState title="No models" message="No model usage recorded" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={modelData}
                      dataKey="pct"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={2}
                    >
                      {modelData.map((m, i) => (
                        <Cell key={m.model} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, 'Share']} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="text-sm" style={{ margin: 'var(--space-3) 0 0', padding: 0, listStyle: 'none' }}>
                  {modelData.slice(0, 5).map((m, i) => (
                    <li key={m.model} className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-2">
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: CHART_COLORS[i % CHART_COLORS.length],
                          }}
                        />
                        {m.label}
                      </span>
                      <strong>{m.pct}%</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card title="Provider Costs" subtitle="Spend by inference provider" style={{ marginTop: 'var(--space-4)' }}>
            {providerCosts.length === 0 ? (
              <EmptyState title="No provider costs" message="Provider pricing not available for this window" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {providerCosts.map((p) => (
                  <div key={p.provider}>
                    <div className="flex items-center justify-between mb-1 text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: PROVIDER_COLORS[p.colorKey] || PROVIDER_COLORS.other,
                          }}
                        />
                        {p.label}
                      </span>
                      <span>{formatUsd(p.costUsd)}</span>
                    </div>
                    <div style={{ background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', height: 14, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${maxProviderCost > 0 ? (p.costUsd / maxProviderCost) * 100 : 0}%`,
                          height: '100%',
                          background: PROVIDER_COLORS[p.colorKey] || PROVIDER_COLORS.other,
                          borderRadius: 'var(--radius-sm)',
                          transition: 'width 500ms ease',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Regime Shift Detector" subtitle="Traffic, block-rate, and model-mix drift" style={{ marginTop: 'var(--space-4)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Badge variant={drift.changeDetected ? 'warning' : 'success'}>
                {drift.changeDetected ? 'Shift detected' : 'Stable'}
              </Badge>
              <span className="text-xs text-muted">Confidence: {drift.caveat.confidence}</span>
            </div>
            <ul className="text-sm text-muted" style={{ margin: 0, paddingLeft: 16 }}>
              <li>Traffic shift: {drift.trafficShiftPct.toFixed(1)}%</li>
              <li>Block-rate shift: {drift.blockRateShiftPct.toFixed(1)} pp</li>
              <li>Model mix JSD: {drift.modelMixJSDivergence.toFixed(3)}</li>
            </ul>
            {drift.caveat.confidence === 'low' ? (
              <p className="text-xs text-muted" style={{ marginTop: 'var(--space-3)' }}>
                Low confidence for this window — try a longer time range for stabler signals.
              </p>
            ) : null}
          </Card>

          {data.budgetUsd != null && data.budgetUtilizationPct != null ? (
            <Card title="Budget Utilization" subtitle={`${formatUsd(data.budgetUsd)} monthly budget`} style={{ marginTop: 'var(--space-4)' }}>
              <div className="mb-2">
                <strong>{Math.round(data.budgetUtilizationPct)}% used</strong>
              </div>
              <div style={{ background: 'var(--bg-muted)', borderRadius: 'var(--radius-lg)', height: 20, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, data.budgetUtilizationPct)}%`,
                    height: '100%',
                    background: data.budgetUtilizationPct > 90 ? 'var(--danger)' : data.budgetUtilizationPct > 70 ? 'var(--warning)' : 'var(--success)',
                    borderRadius: 'var(--radius-lg)',
                    transition: 'width 500ms ease',
                  }}
                />
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchVisualsLive, type HealthResponse, type VisualsData } from '@/lib/mastyf-ai-api';
import { CHART_AXIS, CHART_COLORS, CHART_GRID, CHART_TOOLTIP_STYLE } from '@/lib/chartTheme';
import { KpiCard } from '@/app/components/ui/KpiCard';
import { Card } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { EmptyState } from '@/app/components/ui/EmptyState';
import { computeReliabilityRiskMetrics } from '@/lib/advanced-analytics';
import { trackAdvancedAnalyticsEvent } from '@/lib/mastyf-ai-api';

type ServerRow = NonNullable<HealthResponse['serverReports']>[number];

type Props = {
  health: HealthResponse | null;
  refreshKey?: number;
};

export function HealthReliabilityPanel({ health, refreshKey = 0 }: Props) {
  const [visuals, setVisuals] = useState<VisualsData | null>(null);

  const loadVisuals = useCallback(async () => {
    const v = await fetchVisualsLive();
    setVisuals(v.ok ? v.data : null);
  }, []);

  useEffect(() => {
    void loadVisuals();
  }, [loadVisuals, refreshKey]);

  if (!health) {
    return <EmptyState title="No health data" message="Connect proxy history database to see server health metrics." />;
  }

  const latencyChart = (visuals?.traffic?.byServer ?? []).map((s) => ({
    name: s.serverName,
    p50: s.latencyP50Ms ?? 0,
    p95: s.latencyP95Ms ?? 0,
  }));

  const atRisk = health.atRisk || [];
  const reliability = computeReliabilityRiskMetrics(health, visuals?.traffic?.byServer ?? []);
  const servers = health.serverReports || [];

  useEffect(() => {
    void trackAdvancedAnalyticsEvent({
      feature: 'reliability_risk_index',
      metric: 'index',
      confidence: reliability.caveat.confidence,
      value: reliability.index,
    });
  }, [reliability.caveat.confidence, reliability.index]);

  return (
    <div>
      <div className="kpi-grid">
        <KpiCard
          label="Reliability Risk Index"
          value={reliability.index}
          accent={reliability.status === 'critical' ? 'danger' : reliability.status === 'watch' ? 'warning' : 'success'}
          secondary={`Status: ${reliability.status} · ${reliability.caveat.confidence} confidence`}
        />
        <KpiCard
          label="Avg Latency"
          value={health.avgLatencyMs != null ? `${health.avgLatencyMs}ms` : health.avgLatency != null ? `${health.avgLatency}ms` : '—'}
          accent={health.avgLatencyMs != null && health.avgLatencyMs > 200 ? 'danger' : 'info'}
        />
        <KpiCard
          label="Total Tools"
          value={health.totalTools ?? '—'}
          accent="neutral"
        />
        <KpiCard
          label="At-Risk Servers"
          value={atRisk.length}
          accent={atRisk.length > 0 ? 'danger' : 'success'}
          secondary={atRisk.length ? atRisk.join(', ') : undefined}
        />
      </div>

      <div className="text-sm text-muted mb-4">
        Risk factors — p95 drift {reliability.p95DriftPct.toFixed(1)}%, success gap{' '}
        {reliability.successGapPct.toFixed(1)}%, open circuit-breakers {reliability.circuitBreakerOpenPct.toFixed(1)}%.
      </div>

      <div className="grid grid-12" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="col-span-8">
          <Card title="Latency Distribution" subtitle="p50 vs p95 — widening gap indicates tail latency issues">
            {latencyChart.length === 0 ? (
              <EmptyState title="No latency data" message="No traffic data available to compute latency distribution." />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={latencyChart}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="name" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} unit=" ms" />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="p50" fill={CHART_COLORS[0]} name="p50" />
                  <Bar dataKey="p95" fill={CHART_COLORS[3]} name="p95" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
        <div className="col-span-4">
          <Card title="Success Rate" subtitle="Upstream tool call success percentage">
            {servers.length === 0 ? (
              <EmptyState title="No server data" message="No server reports available." />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={servers.map((h) => ({ name: h.name, rate: h.successRate ?? 0 }))}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="name" {...CHART_AXIS} />
                  <YAxis domain={[0, 100]} {...CHART_AXIS} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="rate" name="Success %">
                    {servers.map((h) => (
                      <Cell key={h.name} fill={(h.successRate ?? 100) < 70 ? CHART_COLORS[2] : CHART_COLORS[1]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      </div>

      <Card title="Server Health Details" subtitle="Latency, success rate, and circuit breaker state per upstream MCP server">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Server</th>
                <th>Latency (ms)</th>
                <th>Success %</th>
                <th>Circuit Breaker</th>
                <th>Tools</th>
              </tr>
            </thead>
            <tbody>
              {servers.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState title="No servers" message="No server health reports available." />
                  </td>
                </tr>
              ) : (
                servers.map((srv) => (
                  <tr key={srv.name} className={srv.successRate != null && srv.successRate < 70 ? 'row-warning' : ''}>
                    <td className="font-medium">{srv.name}</td>
                    <td className="mono">{srv.latency}ms</td>
                    <td className="mono">
                      <Badge variant={srv.successRate != null && srv.successRate < 70 ? 'danger' : 'success'}>
                        {srv.successRate != null ? `${srv.successRate.toFixed(1)}%` : '—'}
                      </Badge>
                    </td>
                    <td>
                      <Badge variant={srv.circuitBreaker === 'open' ? 'danger' : srv.circuitBreaker === 'half-open' ? 'warning' : 'success'}>
                        {srv.circuitBreaker}
                      </Badge>
                    </td>
                    <td className="mono">{(srv as { tools?: number }).tools ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

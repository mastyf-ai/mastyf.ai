'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Bot } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { KpiCard } from '../dashboard/KpiCard';
import { ChartCard } from '../dashboard/ChartCard';
import { CHART_AXIS, CHART_GRID, CHART_SERIES, CHART_TOOLTIP_STYLE } from '@/lib/chartTheme';
import { useAgenticDashboard } from './useAgenticDashboard';
import { gradeColor, formatUptime } from './agentic-utils';
import { useDashboardWindow } from '../dashboard/DashboardWindowContext';
import { PlanCompliancePanel } from './PlanCompliancePanel';

type Props = { refreshKey?: number };

export function AgenticOverviewPanel({ refreshKey = 0 }: Props) {
  const { setWindow } = useDashboardWindow();
  const { data, loading, error, reload } = useAgenticDashboard(refreshKey, 10_000);
  const kpis = data?.kpis;

  const trafficData = useMemo(
    () =>
      (data?.trafficSeries ?? []).map((p) => ({
        label: new Date(p.bucket).toLocaleString(undefined, { month: 'short', day: 'numeric' }),
        requests: p.requests,
        blocked: p.blocked,
      })),
    [data?.trafficSeries],
  );

  const featureData = useMemo(
    () =>
      Object.entries(data?.decisionsByFeature ?? {}).map(([name, count]) => ({
        name: name.length > 18 ? `${name.slice(0, 16)}…` : name,
        count,
      })),
    [data?.decisionsByFeature],
  );

  if (loading && !data) {
    return <p className="hint p-6">Loading agentic dashboard…</p>;
  }

  return (
    <div className="agentic-panel space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="w-6 h-6 text-indigo-500" /> Agentic AI — Overview
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Live metrics from proxy history and agentic services
            {data?.meta?.dataSources?.length ? ` · ${data.meta.dataSources.join(', ')}` : ''}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void reload()}>
          Refresh
        </Button>
      </div>

      {error ? (
        <div className={`banner ${data?.agenticEnabled ? 'banner-info' : 'banner-warn'}`} role="status">
          <p>{error}</p>
          {data?.suggestedWindow ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => setWindow(data.suggestedWindow!)}
            >
              Show last {data.suggestedWindow === '30d' ? '30 days' : '7 days'}
            </Button>
          ) : null}
        </div>
      ) : null}

      <PlanCompliancePanel refreshKey={refreshKey} />

      <Card className="p-5 border-2 border-indigo-200 dark:border-indigo-800">
        <div className="flex items-start gap-4">
          <div className="text-center">
            <span className="text-5xl font-bold" style={{ color: gradeColor(kpis?.trustGrade ?? '—') }}>
              {kpis?.trustGrade ?? '—'}
            </span>
            <div className="text-sm text-gray-500">{kpis?.trustScore ?? 0}/100</div>
          </div>
          <div className="flex-1 text-sm text-gray-600 dark:text-gray-300">
            <p>
              {kpis?.totalRequests
                ? `${kpis.totalRequests.toLocaleString()} proxy requests in window · ${kpis.blockedRequests.toLocaleString()} blocked`
                : 'No proxy traffic in selected time window.'}
            </p>
            <p className="mt-1">
              Agentic uptime {formatUptime(kpis?.uptimeMs ?? 0)} · {kpis?.totalDecisions ?? 0} autonomous decisions ·
              injection detection rate {(100 * (kpis?.injectionDetectionRate ?? 0)).toFixed(1)}%
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Blocked requests" value={kpis?.blockedRequests ?? 0} variant="danger" />
        <KpiCard label="Trust score" value={kpis?.trustScore ?? 0} unit="/100" sub={`Grade ${kpis?.trustGrade ?? '—'}`} />
        <KpiCard label="Compliance" value={kpis?.complianceOverall ?? 0} unit="%" />
        <KpiCard
          label="Task queue"
          value={(kpis?.taskQueued ?? 0) + (kpis?.taskRunning ?? 0)}
          sub={`${kpis?.taskRunning ?? 0} running`}
        />
        <KpiCard label="LLM tokens" value={kpis?.llmTokensUsed ?? 0} sub={`$${(kpis?.llmCostEstimate ?? 0).toFixed(4)} est.`} />
        <KpiCard label="Mesh signatures" value={kpis?.meshSignatures ?? 0} sub={kpis?.meshEnabled ? 'Connected' : 'Disabled'} />
        <KpiCard label="Honeypots" value={kpis?.honeypotActive ?? 0} sub={`${kpis?.honeypotCaptures ?? 0} captures`} />
        <KpiCard label="Active trust sessions" value={kpis?.activeSessions ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Proxy traffic" subtitle="Requests vs blocks (time window)">
          {trafficData.length === 0 ? (
            <p className="hint">No traffic series — generate MCP calls through the proxy.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trafficData}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="label" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="requests" stackId="1" stroke={CHART_SERIES.accent} fill={CHART_SERIES.accent} fillOpacity={0.25} />
                <Area type="monotone" dataKey="blocked" stackId="2" stroke={CHART_SERIES.block} fill={CHART_SERIES.block} fillOpacity={0.35} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Decisions by feature" subtitle="Autonomous agentic decisions">
          {featureData.length === 0 ? (
            <p className="hint">No agentic decisions yet — traffic through proxy populates telemetry.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={featureData}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="name" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="count" fill={CHART_SERIES.accent} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Feature health</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {(data?.featureHealth ?? []).map((f) => (
            <div key={f.name} className="p-2 rounded bg-gray-50 dark:bg-gray-800/50">
              <div className="font-medium">{f.name}</div>
              <div className="text-gray-500">{f.status}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

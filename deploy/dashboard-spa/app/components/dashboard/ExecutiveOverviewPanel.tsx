'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AggregateMetrics } from '@/lib/guardian-api';
import {
  CHART_AXIS,
  CHART_COLORS,
  CHART_GRID,
  CHART_SERIES,
  formatAxisTime,
  topNBuckets,
} from '@/lib/chartTheme';
import { DashboardSection } from './DashboardSection';
import { KpiCard } from './KpiCard';
import { KpiSparkline } from './KpiSparkline';
import { ChartCard } from './ChartCard';
import { InsightsNarrativeRail } from './InsightsNarrativeRail';
import { ChartTooltip, ChartLegend } from './chart-kit';
import { useVisuals } from './VisualsProvider';
import { useDashboardWindow } from './DashboardWindowContext';

type Props = {
  refreshKey?: number;
  metrics?: AggregateMetrics | null;
  semanticFlags?: number;
};

function bucketGranularityForWindow(days: number): 'hour' | 'day' {
  return days <= 7 ? 'hour' : 'day';
}

export function ExecutiveOverviewPanel({ refreshKey = 0, metrics: metricsProp, semanticFlags = 0 }: Props) {
  const { windowDays, window } = useDashboardWindow();
  const { visuals, executiveSummary: summary, loading } = useVisuals();

  const granularity = bucketGranularityForWindow(windowDays);

  const hourly = useMemo(
    () =>
      (visuals?.traffic?.hourly ?? []).map((h) => ({
        label: formatAxisTime(h.hourStart, granularity),
        passed: h.passed,
        blocked: h.blocked,
      })),
    [visuals?.traffic?.hourly, granularity],
  );

  const ruleData = useMemo(() => {
    const raw = (visuals?.traffic?.topBlockRules ?? []).slice(0, 8).map((r) => ({
      name: r.rule.slice(0, 20),
      value: r.count,
    }));
    return topNBuckets(raw, 6);
  }, [visuals?.traffic?.topBlockRules]);

  const ruleLegend = ruleData.map((r, i) => ({
    key: r.name,
    label: r.name,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const totalInWindow = summary?.totalRequests ?? metricsProp?.totalRequests ?? 0;
  const passRateRaw =
    totalInWindow > 0
      ? summary?.passRatePct ??
        metricsProp?.passRate ??
        (metricsProp
          ? ((metricsProp.passedRequests ?? 0) / metricsProp.totalRequests) * 100
          : null)
      : null;
  const passRate = passRateRaw != null && Number.isFinite(passRateRaw) ? passRateRaw : null;

  const cmp = summary?.comparison;
  const spark = summary?.sparklines;
  const trafficMeta = visuals?.meta
    ? {
        window: visuals.meta.window,
        windowDays: visuals.windowDays,
        generatedAt: visuals.meta.generatedAt ?? visuals.generatedAt,
        recordCount: visuals.meta.recordCount,
        sparse: visuals.meta.sparse,
        dataSources: ['history.db'],
      }
    : summary?.meta;

  return (
    <div className="executive-overview-panel">
      <InsightsNarrativeRail scope="overview" refreshKey={refreshKey} />

      <DashboardSection
        title="Executive overview"
        subtitle={`Operational posture — ${window} window from live proxy history`}
        lastUpdated={summary?.timestamp?.slice(0, 19) || metricsProp?.lastUpdated}
      >
        <div className="kpi-row">
          <KpiCard
            label="Total calls"
            value={(summary?.totalRequests ?? metricsProp?.totalRequests ?? 0).toLocaleString()}
            comparison={cmp?.totalRequests ? { ...cmp.totalRequests, label: 'vs prior window' } : undefined}
            sparkline={spark?.totalCalls?.length ? <KpiSparkline data={spark.totalCalls} ariaLabel="Call volume trend" /> : undefined}
            explanation="Intercepted MCP tool invocations recorded in history.db."
          />
          <KpiCard
            label="Pass rate"
            value={passRate != null ? `${passRate.toFixed(1)}%` : '—'}
            variant={passRate != null && passRate < 90 ? 'warn' : 'success'}
            comparison={cmp?.passRatePct ? { ...cmp.passRatePct, label: 'vs prior window' } : undefined}
            explanation="Percentage of calls allowed by policy (non-block)."
          />
          <KpiCard
            label="Block rate"
            value={summary?.blockRatePct != null ? `${summary.blockRatePct}%` : '—'}
            variant={summary?.blockRatePct != null && summary.blockRatePct > 15 ? 'warn' : 'default'}
            comparison={cmp?.blockedRequests ? { ...cmp.blockedRequests, label: 'vs prior window' } : undefined}
            sparkline={spark?.blocked?.length ? <KpiSparkline data={spark.blocked} color={CHART_SERIES.block} ariaLabel="Block trend" /> : undefined}
            explanation="Policy/DLP blocks — high rates may indicate attack traffic or tight rules."
          />
          <KpiCard
            label="Avg latency"
            value={
              summary?.avgLatencyMs ?? metricsProp?.avgLatencyMs
                ? `${Math.round(summary?.avgLatencyMs ?? metricsProp?.avgLatencyMs ?? 0)} ms`
                : '—'
            }
            explanation="Mean proxy evaluation + upstream latency per call."
          />
          <KpiCard
            label="Semantic flags"
            value={semanticFlags}
            variant={semanticFlags > 0 ? 'warn' : 'default'}
            explanation="Async tier-2 LLM semantic audit flags awaiting review."
          />
          <KpiCard
            label="Active servers"
            value={summary?.activeServers ?? metricsProp?.activeServers ?? '—'}
            explanation="Distinct MCP servers with traffic in the current window."
          />
        </div>

        <div className="dash-grid">
          <div className="dash-grid-span-8">
            <ChartCard
              title="Traffic volume"
              subtitle="Pass vs block over time — sudden block spikes often correlate with attacks"
              loading={loading}
              empty={!hourly.some((h) => h.passed + h.blocked > 0)}
              meta={trafficMeta}
              sparse={trafficMeta?.sparse}
              ariaLabel={`Traffic volume chart for ${window}`}
            >
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={hourly}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" {...CHART_AXIS} interval="preserveStartEnd" />
                  <YAxis {...CHART_AXIS} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="passed" stackId="1" stroke={CHART_SERIES.allow} fill={CHART_SERIES.allow} fillOpacity={0.6} name="Passed" />
                  <Area type="monotone" dataKey="blocked" stackId="1" stroke={CHART_SERIES.block} fill={CHART_SERIES.block} fillOpacity={0.6} name="Blocked" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
          <div className="dash-grid-span-4">
            <ChartCard
              title="Block rules"
              subtitle="Which policy rules fire most often"
              loading={loading}
              empty={ruleData.length === 0}
              meta={trafficMeta}
            >
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={ruleData} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={80} label={false}>
                    {ruleData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <ChartLegend items={ruleLegend} />
            </ChartCard>
          </div>
          <div className="dash-grid-span-12">
            <ChartCard
              title="Top tools"
              subtitle="Highest call volume — baseline for anomaly detection"
              loading={loading}
              empty={(summary?.topToolsByCalls?.length ?? 0) === 0}
              meta={summary?.meta}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={summary?.topToolsByCalls?.slice(0, 8) ?? []}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="tool" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="calls" fill={CHART_SERIES.purple} name="Calls" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      </DashboardSection>
    </div>
  );
}

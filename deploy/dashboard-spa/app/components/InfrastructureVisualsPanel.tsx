'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  CHART_AXIS,
  CHART_COLORS,
  CHART_GRID,
  CHART_SERIES,
  formatAxisTime,
  topNBuckets,
} from '@/lib/chartTheme';
import { ChartCard } from './dashboard/ChartCard';
import { ChartTooltip, ChartLegend } from './dashboard/chart-kit';
import { useVisuals } from './dashboard/VisualsProvider';
import { useDashboardWindow } from './dashboard/DashboardWindowContext';

type TabId = 'traffic' | 'learning' | 'semantic' | 'regression';

type Props = {
  refreshKey?: number;
};

export function InfrastructureVisualsPanel({ refreshKey = 0 }: Props) {
  const { windowDays } = useDashboardWindow();
  const { visuals: data, loading, error, refresh } = useVisuals();
  const [tab, setTab] = useState<TabId>('traffic');

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const granularity = windowDays <= 7 ? 'hour' : 'day';

  const hourly = useMemo(
    () =>
      (data?.traffic?.hourly ?? []).map((h) => ({
        label: formatAxisTime(h.hourStart, granularity),
        passed: h.passed,
        blocked: h.blocked,
        calls: h.calls,
        p50: h.latencyP50Ms ?? 0,
      })),
    [data?.traffic?.hourly, granularity],
  );

  const learningSource = data?.instantLearning?.source ?? 'none';
  const learningEmptyReason = data?.meta?.emptyReasons?.instantLearning;

  const learningSeries = useMemo(() => {
    const perMin = data?.instantLearning?.blocksPerMinute ?? [];
    if (perMin.length > 0) {
      return perMin.map((p, i) => ({
        label: String(Math.round(p.t / 60_000)),
        blocks: p.value,
        idx: i,
      }));
    }
    const blockedHourly = hourly.filter((h) => h.blocked > 0 || h.calls > 0);
    if (blockedHourly.length > 0) {
      return blockedHourly.map((h, i) => ({ label: h.label, blocks: h.blocked, idx: i }));
    }
    return [];
  }, [data?.instantLearning?.blocksPerMinute, hourly]);

  const ruleToolChartData = useMemo(() => {
    const pairs = data?.instantLearning?.ruleToolPairs ?? [];
    if (pairs.length > 0) {
      return pairs.slice(0, 8).map((p) => ({
        name: `${p.rule}:${p.tool}`.slice(0, 20),
        count: p.count,
      }));
    }
    return (data?.traffic?.topBlockRules ?? []).slice(0, 8).map((r) => ({
      name: r.plainEnglish?.slice(0, 20) || r.rule.slice(0, 20),
      count: r.count,
    }));
  }, [data?.instantLearning?.ruleToolPairs, data?.traffic?.topBlockRules]);

  const suggestionEngine = data?.instantLearning?.suggestionEngine;
  const learningHasData =
    learningSeries.length > 0 || ruleToolChartData.some((r) => r.count > 0);

  const tools = data?.traffic?.topTools?.slice(0, 8) ?? [];
  const rules = data?.traffic?.topBlockRules?.slice(0, 8) ?? [];
  const servers = data?.traffic?.byServer?.slice(0, 8) ?? [];
  const labelMix = useMemo(() => {
    const raw = (data?.semantic?.labelMix ?? []).map((l) => ({ name: l.label, value: l.count }));
    return topNBuckets(raw, 6);
  }, [data?.semantic?.labelMix]);
  const confBuckets = data?.semantic?.confidenceBuckets ?? [];
  const userServers = data?.regression?.userServers ?? [];

  const trafficMeta = data?.meta
    ? {
        window: data.meta.window,
        windowDays: data.windowDays,
        generatedAt: data.meta.generatedAt ?? data.generatedAt,
        recordCount: data.meta.recordCount,
        sparse: data.meta.sparse,
        dataSources: ['history.db'],
        emptyReason: data.meta.emptyReasons?.traffic,
      }
    : undefined;

  const trafficEmptyReason =
    data?.meta?.emptyReasons?.traffic
    ?? (data?.meta?.dbPath
      ? `No proxy traffic in the selected ${window} window — widen the time window or route MCP through Guardian. Reading ${data.meta.dbPath}.`
      : `No proxy traffic in the selected ${window} window — widen the time window or route MCP through Guardian.`);

  return (
    <section className="infra-visuals-panel" aria-label="Infrastructure visuals">
      <div className="infra-visuals-head">
        <h4>Live infrastructure charts</h4>
        <p className="hint">
          Traffic from <code>history.db</code>
          {data?.meta?.dataSources?.semantic === 'semantic-audit-store'
            ? ' · semantic from live audit store'
            : ''}
          {data?.meta?.swarmSessionLive ? ' · regression from session swarm' : ''}
          {data?.instantLearning?.source ? ` · learning: ${data.instantLearning.source}` : ''}
        </p>
        {!data?.meta?.swarmSessionLive && data?.meta?.emptyReasons?.regression ? (
          <p className="hint live-data-banner">{data.meta.emptyReasons.regression}</p>
        ) : null}
      </div>

      <nav className="infra-visuals-tabs" aria-label="Chart categories">
        {(['traffic', 'learning', 'semantic', 'regression'] as TabId[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'tab active' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t === 'traffic' ? 'Traffic' : t === 'learning' ? 'AI learning' : t === 'semantic' ? 'Semantic' : 'Servers'}
          </button>
        ))}
        <button type="button" className="secondary" disabled={loading} onClick={() => void refresh()}>
          Refresh
        </button>
      </nav>

      {loading && !data ? <p className="hint">Loading charts…</p> : null}
      {error && !data?.traffic?.hasData ? <p className="status status-error">{error}</p> : null}

      {tab === 'traffic' ? (
        <div className="infra-charts-grid">
          <ChartCard
            title="Calls over time"
            loading={loading}
            empty={!hourly.some((h) => h.calls > 0)}
            emptyReason={trafficEmptyReason}
            meta={trafficMeta}
            sparse={trafficMeta?.sparse}
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hourly}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="label" {...CHART_AXIS} interval="preserveStartEnd" />
                <YAxis {...CHART_AXIS} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="passed" stackId="a" fill={CHART_SERIES.allow} name="Passed" />
                <Bar dataKey="blocked" stackId="a" fill={CHART_SERIES.block} name="Blocked" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Latency p50 by server (ms)"
            empty={!servers.length}
            emptyReason={trafficEmptyReason}
            meta={trafficMeta}
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={servers} layout="vertical">
                <CartesianGrid {...CHART_GRID} />
                <XAxis type="number" {...CHART_AXIS} />
                <YAxis type="category" dataKey="serverName" width={90} {...CHART_AXIS} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="latencyP50Ms" fill={CHART_SERIES.accent} name="p50 ms" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Top tools" empty={!tools.length} emptyReason={trafficEmptyReason} meta={trafficMeta}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tools}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="tool" {...CHART_AXIS} interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis {...CHART_AXIS} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill={CHART_SERIES.accent} name="Calls" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Block rules" empty={!rules.length} emptyReason={trafficEmptyReason} meta={trafficMeta}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={rules} layout="vertical">
                <CartesianGrid {...CHART_GRID} />
                <XAxis type="number" {...CHART_AXIS} />
                <YAxis type="category" dataKey="plainEnglish" width={120} {...CHART_AXIS} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill={CHART_SERIES.block} name="Blocks" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      ) : null}

      {tab === 'learning' ? (
        <div className="infra-charts-grid">
          {!learningHasData && learningEmptyReason ? (
            <p className="hint live-data-banner">{learningEmptyReason}</p>
          ) : null}
          {suggestionEngine?.learningInitialized ? (
            <p className="hint">
              Suggestion engine: {suggestionEngine.cyclesCompleted ?? 0} cycles ·{' '}
              {suggestionEngine.baselinesCount ?? 0} baselines ·{' '}
              {suggestionEngine.recordsAnalyzed ?? 0} records analyzed
            </p>
          ) : null}
          <ChartCard
            title={
              (data?.instantLearning?.blocksPerMinute?.length ?? 0) > 0
                ? `Blocks per minute (${learningSource})`
                : 'Blocks over time (history.db)'
            }
            empty={!learningSeries.length}
            emptyReason={learningEmptyReason}
          >
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={learningSeries}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="label" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="blocks" stroke={CHART_SERIES.accent} strokeWidth={2} dot={false} name="Blocks" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title={learningSource === 'history-db-fallback' ? 'Top block rules (history.db)' : 'Rule:tool clusters'}
            empty={!ruleToolChartData.length}
            emptyReason={learningEmptyReason}
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ruleToolChartData} layout="vertical">
                <CartesianGrid {...CHART_GRID} />
                <XAxis type="number" {...CHART_AXIS} />
                <YAxis type="category" dataKey="name" width={100} {...CHART_AXIS} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill={CHART_SERIES.purple} name="Count" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <p className="hint">
            Events: {data?.instantLearning?.totalEvents ?? 0} · Queued suggestions:{' '}
            {data?.instantLearning?.queuedSuggestions ?? 0}
            {learningEmptyReason && learningHasData ? ` · ${learningEmptyReason}` : ''}
          </p>
        </div>
      ) : null}

      {tab === 'semantic' ? (
        <div className="infra-charts-grid">
          {!data?.semantic?.hasData && data?.meta?.emptyReasons?.semantic ? (
            <p className="hint live-data-banner">{data.meta.emptyReasons.semantic}</p>
          ) : null}
          <ChartCard title="Confidence buckets" empty={!confBuckets.length}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={confBuckets}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="bucket" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill={CHART_SERIES.purple} name="Count" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Label mix" empty={!labelMix.length}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={labelMix} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={70} label={false}>
                  {labelMix.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <ChartLegend
              items={labelMix.map((l, i) => ({
                key: l.name,
                label: l.name,
                color: CHART_COLORS[i % CHART_COLORS.length],
              }))}
            />
          </ChartCard>
        </div>
      ) : null}

      {tab === 'regression' ? (
        <div className="infra-charts-grid">
          <ChartCard title="Your server probes" empty={!userServers.length}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={userServers}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="serverName" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="toolCount" fill={CHART_SERIES.allow} name="Tools" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <p className="hint">Regression gate PNGs are in the figure gallery below.</p>
        </div>
      ) : null}
    </section>
  );
}

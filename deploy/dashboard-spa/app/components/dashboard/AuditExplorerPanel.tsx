'use client';

import { useCallback, useEffect, useState } from 'react';
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
  type AuditResponse,
  type AuditHeatmapResponse,
} from '@/lib/guardian-api';
import { CHART_AXIS, CHART_GRID, CHART_SERIES } from '@/lib/chartTheme';
import { DashboardSection } from './DashboardSection';
import { KpiCard } from './KpiCard';
import { ChartCard } from './ChartCard';
import { InsightsNarrativeRail } from './InsightsNarrativeRail';
import { DataTablePro, type Column } from './DataTablePro';
import { ChartTooltip } from './chart-kit';
import { AuditActivityHeatmap } from './AuditActivityHeatmap';
import { useDashboardWindow } from './DashboardWindowContext';

type EventRow = NonNullable<AuditResponse['events']>[number];

type Props = {
  audit: AuditResponse | null;
  refreshKey?: number;
  auditAction: string;
  auditServer: string;
  onFilterChange: (action: string, server: string) => void;
  onApplyFilters: () => void;
  onFpReject: (rule: string, pattern: string) => void;
  canMutate: boolean;
};

export function AuditExplorerPanel({
  audit,
  refreshKey = 0,
  auditAction,
  auditServer,
  onFilterChange,
  onApplyFilters,
  onFpReject,
  canMutate,
}: Props) {
  const { windowDays, windowParam, window } = useDashboardWindow();
  const [heatmap, setHeatmap] = useState<AuditHeatmapResponse | null>(null);

  const loadHeatmap = useCallback(async () => {
    setHeatmap(await fetchAuditHeatmap(windowParam || windowDays));
  }, [windowDays, windowParam]);

  useEffect(() => {
    void loadHeatmap();
  }, [loadHeatmap, refreshKey]);

  const heatmapChart = (heatmap?.cells ?? []).slice(0, 12).map((c) => ({
    label: `${c.rule.slice(0, 12)} · ${c.tool.slice(0, 12)}`,
    count: c.count,
  }));

  const columns: Column<EventRow>[] = [
    { key: 'time', header: 'Time', render: (e) => e.timestamp?.slice(11, 19) || '—' },
    { key: 'server', header: 'Server', render: (e) => e.server_name || '—', sortValue: (e) => e.server_name || '' },
    { key: 'tool', header: 'Tool', render: (e) => e.tool_name || '—', sortValue: (e) => e.tool_name || '' },
    { key: 'action', header: 'Action', render: (e) => e.action, sortValue: (e) => e.action },
    { key: 'rule', header: 'Rule', render: (e) => e.rule || '—', sortValue: (e) => e.rule || '' },
    {
      key: 'cost',
      header: 'Cost',
      render: (e) => (e.cost_usd != null ? `$${e.cost_usd.toFixed(4)}` : '—'),
      sortValue: (e) => e.cost_usd ?? 0,
    },
  ];

  const events = audit?.events || [];

  return (
    <div className="audit-explorer-panel">
      <InsightsNarrativeRail scope="audit" refreshKey={refreshKey} />

      <DashboardSection
        title="Live audit explorer"
        subtitle={`SIEM-style view — ${window} window from history.db`}
      >
        <div className="kpi-row">
          <KpiCard label="Total events" value={audit?.total?.toLocaleString() ?? '—'} />
          <KpiCard label="Blocked" value={audit?.blocked?.toLocaleString() ?? '—'} variant="warn" />
          <KpiCard label="Passed" value={audit?.passed?.toLocaleString() ?? '—'} variant="success" />
          <KpiCard
            label="Semantic flags"
            value={audit?.flagged ?? audit?.semanticAudit?.flagged ?? 0}
            sub={
              audit?.semanticAudit?.enabled
                ? `Q ${audit.semanticAudit.queued} · P ${audit.semanticAudit.processed}`
                : undefined
            }
          />
        </div>

        <div className="filter-row">
          <label className="inline">
            Action
            <select
              value={auditAction}
              onChange={(e) => onFilterChange(e.target.value, auditServer)}
              aria-label="Filter by action"
            >
              <option value="">All</option>
              <option value="block">block</option>
              <option value="pass">pass</option>
            </select>
          </label>
          <label className="inline">
            Server
            <input
              type="text"
              placeholder="server name"
              value={auditServer}
              onChange={(e) => onFilterChange(auditAction, e.target.value)}
            />
          </label>
          <button type="button" className="secondary" onClick={onApplyFilters}>
            Apply filters
          </button>
        </div>

        <div className="dash-grid">
          <div className="dash-grid-span-12">
            <ChartCard
              title="Activity heatmap"
              subtitle={`Day × hour event density (${window})`}
              empty={!heatmap?.activity?.days?.length}
              meta={heatmap?.meta}
            >
              <AuditActivityHeatmap activity={heatmap?.activity} />
            </ChartCard>
          </div>
          <div className="dash-grid-span-12">
            <ChartCard
              title="Block patterns (rule × tool)"
              subtitle="Top combinations driving blocks"
              empty={heatmapChart.length === 0}
              meta={heatmap?.meta}
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={heatmapChart} layout="vertical">
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis type="number" {...CHART_AXIS} />
                  <YAxis type="category" dataKey="label" width={140} {...CHART_AXIS} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" fill={CHART_SERIES.block} name="Blocks" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>

        <DataTablePro
          columns={columns}
          rows={events}
          rowKey={(e, i) => `${e.timestamp}-${i}`}
          pageSize={25}
          exportFilename="guardian-audit.csv"
          expandable={(e) => (
            <div>
              <strong>Reason:</strong> {e.reason || '—'}
              {e.action === 'block' && e.rule && canMutate ? (
                <p>
                  <button
                    type="button"
                    className="secondary btn-sm"
                    onClick={() => onFpReject(e.rule || '', e.reason || e.tool_name || '')}
                  >
                    FP reject (3-strike)
                  </button>
                </p>
              ) : null}
            </div>
          )}
        />
      </DashboardSection>
    </div>
  );
}

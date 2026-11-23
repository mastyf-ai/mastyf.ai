'use client';

import { useEffect, useState } from 'react';
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
import { fetchCost, type CostResponse, type SecurityResponse } from '@/lib/mastyf-ai-api';
import { CHART_AXIS, CHART_COLORS, CHART_GRID, CHART_TOOLTIP_STYLE, severityColor } from '@/lib/chartTheme';
import { DashboardSection } from './DashboardSection';
import { KpiCard } from './KpiCard';
import { ChartCard } from './ChartCard';
import { InsightsNarrativeRail } from './InsightsNarrativeRail';
import { DataTablePro, type Column } from './DataTablePro';
import { computeCostRiskRoiMetrics } from '@/lib/advanced-analytics';

type ServerRow = NonNullable<SecurityResponse['serverReports']>[number];

type Props = {
  security: SecurityResponse | null;
  refreshKey?: number;
  onOpenThreatDiscovery?: () => void;
};

export function SecurityPosturePanel({ security, refreshKey = 0, onOpenThreatDiscovery }: Props) {
  const [cost, setCost] = useState<CostResponse | null>(null);
  useEffect(() => {
    void fetchCost(7).then((resp) => setCost(resp));
  }, [refreshKey]);
  if (!security) {
    return (
      <DashboardSection title="Security posture" subtitle="Manifest scan scores from proxy preflight">
        <p className="muted">No security scan data — run scan via CLI or wait for proxy traffic.</p>
      </DashboardSection>
    );
  }

  const chartData = (security.serverReports || [])
    .filter((s) => s.scanned !== false)
    .map((s) => ({
      name: s.name,
      score: s.score ?? 0,
      critical: s.critical ?? 0,
      high: s.high ?? 0,
    }));

  const columns: Column<ServerRow>[] = [
    { key: 'name', header: 'Server', render: (r) => r.name, sortValue: (r) => r.name },
    {
      key: 'score',
      header: 'Score',
      render: (r) => (r.score != null ? `${r.score}/100` : '—'),
      sortValue: (r) => r.score ?? 0,
    },
    { key: 'critical', header: 'Critical', render: (r) => r.critical ?? '—', sortValue: (r) => r.critical ?? 0 },
    { key: 'high', header: 'High', render: (r) => r.high ?? '—', sortValue: (r) => r.high ?? 0 },
  ];

  const scoreVariant =
    security.overallScore != null && security.overallScore < 70
      ? 'danger'
      : security.overallScore != null && security.overallScore < 85
        ? 'warn'
        : 'success';

  const roi = computeCostRiskRoiMetrics(cost, security);

  return (
    <div className="security-posture-panel">
      <InsightsNarrativeRail scope="security" refreshKey={refreshKey} />

      <DashboardSection
        title="Security posture"
        subtitle="Tool manifest scan scores — lower scores need immediate review"
        lastUpdated={security.lastScan || undefined}
      >
        <div className="kpi-row">
          <KpiCard
            label="Overall score"
            value={security.overallScore != null ? `${security.overallScore}/100` : '—'}
            variant={scoreVariant}
            explanation="Weighted aggregate of per-server manifest security scans."
          />
          <KpiCard
            label="Active threats"
            value={security.activeThreats ?? 0}
            variant={security.activeThreats > 0 ? 'warn' : 'default'}
            explanation="ThreatIntel catalog items matching your MCP surface."
          />
          <KpiCard
            label="Servers scanned"
            value={chartData.length}
            explanation="MCP servers with at least one completed security scan."
          />
          <KpiCard
            label="Net security ROI"
            value={`$${roi.netSecurityRoiUsd.toFixed(2)}`}
            variant={roi.netSecurityRoiUsd >= 0 ? 'success' : 'warn'}
            sub={`Confidence: ${roi.caveat.confidence}`}
            explanation="Expected incident-loss avoided minus estimated security operational overhead."
          />
        </div>
        <p className="hint">
          Cost-of-risk model: avoided ${roi.expectedLossAvoidedUsd.toFixed(2)} vs operational $
          {roi.securityOperationalCostUsd.toFixed(2)}.
        </p>
        {roi.caveat.confidence === 'low' ? (
          <p className="alert">
            ROI confidence is low because pricing coverage is limited; calibrate incident-loss assumptions before enforcement decisions.
          </p>
        ) : null}

        {security.activeThreats > 0 && onOpenThreatDiscovery ? (
          <p className="banner-inline">
            {security.activeThreats} active threat(s) —{' '}
            <button type="button" className="linkish" onClick={onOpenThreatDiscovery}>
              open Threat Discovery
            </button>
          </p>
        ) : null}

        <div className="dash-grid">
          <div className="dash-grid-span-8">
            <ChartCard
              title="Score by server"
              subtitle="Compare manifest hygiene across MCP servers"
              empty={chartData.length === 0}
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="name" {...CHART_AXIS} />
                  <YAxis domain={[0, 100]} {...CHART_AXIS} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="score" name="Score">
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={severityColor(entry.score)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
          <div className="dash-grid-span-4">
            <ChartCard
              title="Finding severity"
              subtitle="Critical + high counts per server"
              empty={chartData.length === 0}
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="name" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="critical" stackId="a" fill={CHART_COLORS[2]} name="Critical" />
                  <Bar dataKey="high" stackId="a" fill={CHART_COLORS[3]} name="High" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>

        <DataTablePro
          columns={columns}
          rows={security.serverReports || []}
          rowKey={(r) => r.name}
          exportFilename="mastyf-ai-security-posture.csv"
        />
      </DashboardSection>
    </div>
  );
}

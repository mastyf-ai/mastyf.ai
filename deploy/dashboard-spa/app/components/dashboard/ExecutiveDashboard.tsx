'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  AggregateMetrics,
  ExecutiveSummaryResponse,
  HealthResponse,
  SecurityResponse,
  CostResponse,
  AuditResponse,
} from '@/lib/mastyf-ai-api';
import {
  fetchExecutiveSummary,
  fetchAggregateMetrics,
  fetchHealth,
  fetchSecurity,
  fetchCost,
  fetchAudit,
  fetchDashboardInsights,
  type DashboardInsightsResponse,
} from '@/lib/mastyf-ai-api';
import { KpiCard } from '../ui/KpiCard';
import { Badge, SeverityBadge } from '../ui/Badge';
import { useCurrentWindowDays } from './DashboardWindowContext';

interface ExecutiveDashboardProps {
  refreshKey: number;
  onNavigateAdvanced: (ws: string, view: string) => void;
}

export function ExecutiveDashboard({ refreshKey, onNavigateAdvanced }: ExecutiveDashboardProps) {
  const [summary, setSummary] = useState<ExecutiveSummaryResponse | null>(null);
  const [metrics, setMetrics] = useState<AggregateMetrics | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [security, setSecurity] = useState<SecurityResponse | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [insights, setInsights] = useState<DashboardInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const { windowDays } = useCurrentWindowDays();

  const loadData = useCallback(async () => {
    setLoading(true);
    const [sum, met, heal, sec, cst, aud, ins] = await Promise.all([
      fetchExecutiveSummary(windowDays).catch(() => null),
      fetchAggregateMetrics(windowDays).catch(() => null),
      fetchHealth().catch(() => null),
      fetchSecurity().catch(() => null),
      fetchCost(windowDays).catch(() => null),
      fetchAudit({ windowDays, limit: 20 }).catch(() => null),
      fetchDashboardInsights('overview', windowDays).catch(() => null),
    ]);
    if (sum) setSummary(sum);
    if (met) setMetrics(met);
    if (heal) setHealth(heal);
    if (sec) setSecurity(sec);
    if (cst) setCost(cst);
    if (aud) setAudit(aud);
    if (ins) setInsights(ins);
    setLoading(false);
  }, [windowDays]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshKey]);

  const totalRequests = summary?.totalRequests ?? metrics?.totalRequests ?? 0;
  const blockedRequests = summary?.blockedRequests ?? metrics?.blockedRequests ?? 0;
  const passRate = summary?.passRatePct ?? metrics?.passRate;
  const totalCost = summary?.totalCostUsd ?? cost?.totalCost ?? 0;
  const activeServers = summary?.activeServers ?? metrics?.activeServers ?? 0;
  const avgLatency = summary?.avgLatencyMs ?? metrics?.avgLatencyMs;
  const activeThreats = security?.activeThreats ?? 0;
  const overallScore = security?.overallScore;
  const healthStatus = health?.overallStatus || 'unknown';
  const burnRate = summary?.burnRatePerHour ?? cost?.burnRatePerHour;

  const recentEvents = audit?.events?.slice(0, 8) || [];
  const blockedCount = audit?.blocked ?? 0;

  const passRateVal = passRate != null ? passRate : (totalRequests > 0 ? ((totalRequests - blockedRequests) / totalRequests * 100) : null);

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1>Security Operations Dashboard</h1>
          <p>Real-time visibility into your MCP ecosystem security posture</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm" onClick={() => onNavigateAdvanced('security', 'overview')}>
            View Security Center
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid">
        <KpiCard
          label="Total Requests"
          value={totalRequests.toLocaleString()}
          accent="info"
          delta={summary?.comparison?.totalRequests ? {
            value: `${Math.abs(summary.comparison.totalRequests.deltaPct || 0).toFixed(1)}%`,
            direction: summary.comparison.totalRequests.direction,
          } : undefined}
          secondary={`${windowDays}d window`}
        />
        <KpiCard
          label="Pass Rate"
          value={passRateVal != null ? `${passRateVal.toFixed(1)}%` : '—'}
          accent={passRateVal != null && passRateVal >= 95 ? 'success' : passRateVal != null && passRateVal >= 80 ? 'warning' : 'danger'}
          secondary={blockedRequests > 0 ? `${blockedRequests.toLocaleString()} blocked` : 'No blocks'}
        />
        <KpiCard
          label="Security Score"
          value={overallScore != null ? `${overallScore}/100` : '—'}
          accent={overallScore != null && overallScore >= 80 ? 'success' : overallScore != null && overallScore >= 50 ? 'warning' : 'danger'}
          secondary={activeThreats > 0 ? `${activeThreats} active threats` : 'No active threats'}
        />
        <KpiCard
          label="Total Cost"
          value={totalCost != null ? `$${totalCost.toFixed(2)}` : '—'}
          accent="neutral"
          delta={cost?.projectedMonthly ? {
            value: `$${cost.projectedMonthly.toFixed(0)}/mo projected`,
            direction: 'up',
          } : undefined}
          secondary={burnRate != null ? `$${burnRate.toFixed(3)}/hr burn rate` : undefined}
        />
        <KpiCard
          label="Active Servers"
          value={activeServers}
          accent={healthStatus === 'healthy' ? 'success' : healthStatus === 'degraded' ? 'warning' : 'info'}
          secondary={
            avgLatency != null
              ? `${avgLatency.toFixed(0)}ms avg latency`
              : 'Health data pending'
          }
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-12">
        {/* Health & Security Posture */}
        <div className="col-span-8">
          <div className="section">
            <div className="section-header">
              <div>
                <h2 className="section-title">System Health</h2>
                <p className="section-subtitle">MCP server status and performance metrics</p>
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ padding: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Server</th>
                      <th>Status</th>
                      <th>Latency</th>
                      <th>Success Rate</th>
                      <th>Circuit Breaker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health?.serverReports && health.serverReports.length > 0 ? (
                      health.serverReports.map((srv) => (
                        <tr key={srv.name}>
                          <td><span className="font-medium">{srv.name}</span></td>
                          <td>
                            <Badge variant={
                              (srv.successRate ?? 1) >= 0.95 ? 'live'
                              : (srv.successRate ?? 1) >= 0.8 ? 'degraded'
                              : 'offline'
                            } dot>
                              {(srv.successRate ?? 1) >= 0.95 ? 'Healthy'
                                : (srv.successRate ?? 1) >= 0.8 ? 'Degraded'
                                : 'Unhealthy'}
                            </Badge>
                          </td>
                          <td className="mono">{srv.latency?.toFixed(0) ?? '—'}ms</td>
                          <td className="mono">
                            {srv.successRate != null ? `${(srv.successRate * 100).toFixed(1)}%` : '—'}
                          </td>
                          <td>
                            <Badge variant={
                              srv.circuitBreaker === 'CLOSED' ? 'success'
                              : srv.circuitBreaker === 'HALF_OPEN' ? 'warning'
                              : 'danger'
                            }>
                              {srv.circuitBreaker ?? '—'}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5}>
                          <div className="empty-state" style={{ padding: 'var(--space-8) var(--space-4)' }}>
                            <div className="empty-state-title">No server data</div>
                            <div className="empty-state-desc">Connect MCP servers to see health metrics</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="section">
            <div className="section-header">
              <div>
                <h2 className="section-title">Recent Activity</h2>
                <p className="section-subtitle">Latest tool calls and policy decisions</p>
              </div>
              <div className="section-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => onNavigateAdvanced('activity', 'audit')}>
                  View All
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-body" style={{ padding: 0 }}>
                {recentEvents.length > 0 ? (
                  <div className="timeline">
                    {recentEvents.map((evt, i) => (
                      <div key={i} className="timeline-entry">
                        <span className={`timeline-dot ${evt.action}`} />
                        <div className="timeline-head">
                          <span>{new Date(evt.timestamp).toLocaleString()}</span>
                          {evt.server_name && <span className="text-muted">{evt.server_name}</span>}
                        </div>
                        <div className="timeline-title">
                          <Badge variant={evt.action === 'block' ? 'danger' : evt.action === 'flag' ? 'warning' : 'success'}>{evt.action}</Badge>
                          {' '}{evt.tool_name}
                        </div>
                        {evt.reason && <div className="timeline-desc">{evt.reason}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: 'var(--space-8) var(--space-4)' }}>
                    <div className="empty-state-title">No recent activity</div>
                    <div className="empty-state-desc">Tool calls will appear here once agents interact with MCP servers</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="col-span-4">
          {/* Security Summary */}
          <div className="section">
            <div className="section-header">
              <h2 className="section-title">Security Posture</h2>
            </div>

            <div className="card mb-4">
              <div className="card-body">
                <div className="risk-gauge mb-4">
                  <div className={`risk-gauge-ring ${
                    overallScore != null && overallScore >= 80 ? 'low'
                    : overallScore != null && overallScore >= 60 ? 'moderate'
                    : overallScore != null && overallScore >= 40 ? 'elevated'
                    : overallScore != null && overallScore >= 20 ? 'high'
                    : 'critical'
                  }`}>
                    {overallScore ?? '?'}
                  </div>
                  <div className="risk-gauge-info">
                    <span className="risk-gauge-label">Security Score</span>
                    <span className="risk-gauge-value">
                      {overallScore != null && overallScore >= 80 ? 'Good'
                        : overallScore != null && overallScore >= 60 ? 'Fair'
                        : overallScore != null && overallScore >= 40 ? 'Needs Attention'
                        : 'Critical'}
                    </span>
                    <span className="text-xs text-muted">
                      {activeThreats > 0 ? `${activeThreats} active threats` : 'No threats detected'}
                    </span>
                  </div>
                </div>

                {security?.serverReports && (
                  <table className="table table-compact" style={{ border: 0 }}>
                    <thead>
                      <tr>
                        <th>Server</th>
                        <th>Score</th>
                        <th>Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {security.serverReports.slice(0, 6).map((srv) => (
                        <tr key={srv.name}>
                          <td className="truncate" style={{ maxWidth: 120 }}>{srv.name}</td>
                          <td>
                            <Badge variant={
                              srv.score != null && srv.score >= 80 ? 'success'
                              : srv.score != null && srv.score >= 50 ? 'warning'
                              : 'danger'
                            }>
                              {srv.score ?? '?'}
                            </Badge>
                          </td>
                          <td>
                            {srv.critical != null && srv.critical > 0 && (
                              <span className="text-danger">{srv.critical} C</span>
                            )}
                            {srv.high != null && srv.high > 0 && (
                              <span className="text-warning"> {srv.high} H</span>
                            )}
                            {(!srv.critical || srv.critical === 0) && (!srv.high || srv.high === 0) && (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card-footer">
                <button className="btn btn-ghost btn-sm" onClick={() => onNavigateAdvanced('security', 'overview')}>
                  Open Security Center
                </button>
              </div>
            </div>
          </div>

          {/* Top Cost Servers */}
          {summary?.topServersByCost && summary.topServersByCost.length > 0 && (
            <div className="section">
              <div className="section-header">
                <h2 className="section-title">Top Cost Servers</h2>
              </div>
              <div className="card">
                <div className="card-body" style={{ padding: 0 }}>
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Server</th>
                        <th className="mono">Cost</th>
                        <th className="mono">Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topServersByCost.slice(0, 5).map((srv) => (
                        <tr key={srv.server}>
                          <td className="truncate" style={{ maxWidth: 140 }}>{srv.server}</td>
                          <td className="mono">${srv.costUsd.toFixed(2)}</td>
                          <td className="mono">{srv.calls.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-footer">
                  <button className="btn btn-ghost btn-sm" onClick={() => onNavigateAdvanced('cost', 'overview')}>
                    View Cost Analytics
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* AI Insights */}
          {insights?.bullets && insights.bullets.length > 0 && (
            <div className="section">
              <div className="section-header">
                <h2 className="section-title">Analysis</h2>
              </div>
              <div className="insight">
                <div className="insight-title">Key Findings</div>
                <ul className="insight-list">
                  {insights.bullets.slice(0, 4).map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

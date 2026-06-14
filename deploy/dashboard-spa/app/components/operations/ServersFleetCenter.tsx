'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchFleetInstances, fetchHealth, type FleetResponse, type HealthResponse } from '@/lib/mastyf-ai-api';
import { Card } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { KpiCard } from '@/app/components/ui/KpiCard';
import { EmptyState } from '@/app/components/ui/EmptyState';
import { WorkspaceSubNav } from '@/app/components/ui/WorkspaceSubNav';
import { LiveMcpServersPanel } from '@/app/components/live/LiveMcpServersPanel';
import { HealthReliabilityPanel } from '@/app/components/dashboard/HealthReliabilityPanel';

type FleetView = 'overview' | 'health' | 'certifications';

type Props = {
  view: FleetView;
  onViewChange: (v: FleetView) => void;
  health: HealthResponse | null;
  refreshKey: number;
};

function FleetOverview() {
  const [fleet, setFleet] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const f = await fetchFleetInstances().catch(() => null);
    if (f) setFleet(f);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalInstances = fleet?.totalInstances ?? 0;
  const activeInstances = fleet?.activeInstances ?? 0;
  const totalRequests = fleet?.totalRequests ?? 0;
  const totalBlocked = fleet?.totalBlocked ?? 0;
  const totalCost = fleet?.totalCostUsd ?? 0;
  const instances = fleet?.instances ?? [];

  const blockRate = totalRequests > 0 ? ((totalBlocked / totalRequests) * 100).toFixed(1) : '0.0';

  const onlineCount = instances.filter(i => i.status === 'online' || i.status === 'active').length;
  const offlineCount = instances.filter(i => i.status === 'offline' || i.status === 'down').length;
  const degradedCount = instances.filter(i => i.status === 'degraded').length;

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Total Instances" value={totalInstances} accent="info" secondary={`${activeInstances} active`} />
        <KpiCard label="Fleet Status" value={onlineCount > 0 ? `${onlineCount} online` : 'Offline'} accent={onlineCount > 0 ? 'success' : 'danger'} />
        <KpiCard label="Total Requests" value={totalRequests.toLocaleString()} accent="info" secondary={`${blockRate}% blocked`} />
        <KpiCard label="Total Cost" value={`$${totalCost.toFixed(2)}`} accent="neutral" />
      </div>

      <Card title="Fleet Instances" subtitle="All registered MCP server instances">
        {loading ? (
          <p className="text-sm text-muted">Loading fleet…</p>
        ) : instances.length === 0 ? (
          <EmptyState title="No instances" message="No MCP server instances are registered" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Instance</th>
                  <th>Hostname</th>
                  <th>Status</th>
                  <th>Requests</th>
                  <th>Blocked</th>
                  <th>Latency</th>
                  <th>Cost</th>
                  <th>Last Heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => (
                  <tr key={inst.instanceId} className={inst.status === 'offline' || inst.status === 'down' ? 'row-critical' : inst.status === 'degraded' ? 'row-warning' : ''}>
                    <td><code className="text-xs">{inst.instanceId}</code></td>
                    <td>{inst.hostname || '—'}</td>
                    <td>
                      <Badge variant={inst.status === 'online' || inst.status === 'active' ? 'live' : inst.status === 'degraded' ? 'degraded' : 'offline'} dot>
                        {inst.status || 'unknown'}
                      </Badge>
                    </td>
                    <td className="mono">{inst.totalRequests?.toLocaleString() ?? '—'}</td>
                    <td className="mono">{inst.blockedRequests?.toLocaleString() ?? '—'}</td>
                    <td className="mono">{inst.avgLatencyMs != null ? `${inst.avgLatencyMs.toFixed(0)}ms` : '—'}</td>
                    <td className="mono">{inst.totalCostUsd != null ? `$${inst.totalCostUsd.toFixed(2)}` : '—'}</td>
                    <td className="text-xs text-muted">{inst.lastHeartbeat ? new Date(inst.lastHeartbeat).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Server Configuration" subtitle="Manage MCP server definitions">
        <LiveMcpServersPanel />
      </Card>
    </>
  );
}

export function ServersFleetCenter({ view, onViewChange, health, refreshKey }: Props) {
  const VIEW_TABS = [
    { id: 'overview' as const, label: 'Fleet Overview' },
    { id: 'health' as const, label: 'Health & Performance' },
    { id: 'certifications' as const, label: 'Certifications' },
  ];

  return (
    <section aria-label="MCP Fleet Management">
      <div className="page-header">
        <div>
          <h1>MCP Fleet Management</h1>
          <p>Operational status, health, and configuration of all MCP servers</p>
        </div>
      </div>

      <WorkspaceSubNav tabs={VIEW_TABS} active={view} onChange={onViewChange} />

      {view === 'overview' && <FleetOverview />}
      {view === 'health' && <HealthReliabilityPanel health={health} refreshKey={refreshKey} />}
      {view === 'certifications' && <FleetOverview />}
    </section>
  );
}

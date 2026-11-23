'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Ban, Check, Clock3 } from 'lucide-react';
import {
  fetchAudit,
  fetchFleetHubStatus,
  type AggregateMetrics,
  type AuditEvent,
  type FleetHubState,
  type FleetResponse,
  type HealthResponse,
} from '@/lib/mastyf-ai-api';
import { useAuthSession } from '../AuthSessionContext';
import { useDashboardWindow, type DashboardWindow } from '../dashboard/DashboardWindowContext';
import type { WorkspaceId } from '@/lib/workspace-nav';
import { CountUp } from '../ui/motion';
import { AgentsCard } from './AgentsCard';
import { ProtectionCard } from './ProtectionCard';
import { useProtection } from './useProtection';
import { BlockedRequests, RecentRequests, ThisWeek } from './HomeActivity';
import { ProtocolXPlayground } from './ProtocolXPlayground';
import { ShieldLayers } from './ShieldLayers';
import { PlanCompare } from './PlanCompare';

type Props = {
  /** Windowed metrics from REST (never the all-time live patch), or null while loading. */
  metrics: AggregateMetrics | null;
  /** True once the first full data refresh has finished. */
  loaded: boolean;
  fleet: FleetResponse | null;
  health: HealthResponse | null;
  connection: 'live' | 'degraded' | 'offline' | 'connecting';
  refreshKey: number;
  onNavigate: (ws: WorkspaceId, view?: string) => void;
};

const PERIODS: { value: DashboardWindow; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

/**
 * Home, laid out like the Mastyf Shield app. Every figure is read from this install: which servers
 * Fleet Hub is routing right now, the request counts for the chosen period, and the recorded calls.
 */
export function ShieldHome({ metrics, connection, refreshKey, onNavigate }: Props) {
  const { status } = useAuthSession();
  const { window: period, setWindow } = useDashboardWindow();
  const paid = status?.plan === 'paid';
  const upgradeUrl = status?.upgradeUrl ?? null;

  const protection = useProtection();
  const [fleet, setFleet] = useState<FleetHubState | null | undefined>(undefined);
  const [events, setEvents] = useState<(AuditEvent & { duration_ms?: number })[] | null>(null);

  const load = useCallback(async () => {
    const [f, audit] = await Promise.all([
      fetchFleetHubStatus().catch(() => ({ entries: [], fleet: null })),
      fetchAudit({ windowParam: '90d', limit: 500 }).catch(() => null),
    ]);
    setFleet(f.fleet ?? null);
    setEvents((audit?.events ?? []) as (AuditEvent & { duration_ms?: number })[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const checked = metrics?.totalRequests ?? 0;
  const allowed = metrics?.passedRequests ?? 0;
  const blocked = metrics?.blockedRequests ?? 0;
  const avg = metrics?.avgLatencyMs ?? 0;
  const ready = !!metrics;

  return (
    <div className="sh-home">
      <div className="sh-top">
        <ProtectionCard
          protection={protection}
          connection={connection}
          fleetServers={(fleet?.servers ?? []).map((s) => s.name)}
          onLive={() => onNavigate('activity', 'realtime')}
        />
        <AgentsCard protection={protection} paid={paid} upgradeUrl={upgradeUrl} />
      </div>

      <section aria-labelledby="req-title" className="sh-requests">
        <div className="sh-row-head">
          <h2 id="req-title" className="sh-h2">Requests</h2>
          <div className="seg" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="tab"
                aria-selected={period === p.value}
                className={`seg-item${period === p.value ? ' active' : ''}`}
                onClick={() => setWindow(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="sh-tiles">
          <button type="button" className="sh-tile" onClick={() => onNavigate('activity', 'audit')}>
            <span className="sh-tile-num">{ready ? <CountUp value={checked} /> : '…'}</span>
            <span className="sh-tile-label">Requests checked</span>
            <span className="sh-tile-icon gold" aria-hidden="true"><Activity size={20} /></span>
          </button>
          <button type="button" className="sh-tile" onClick={() => onNavigate('activity', 'audit')}>
            <span className="sh-tile-num">{ready ? <CountUp value={allowed} /> : '…'}</span>
            <span className="sh-tile-label">Allowed</span>
            <span className="sh-tile-icon green" aria-hidden="true"><Check size={20} /></span>
          </button>
          <button type="button" className="sh-tile" onClick={() => onNavigate('activity', 'audit')}>
            <span className="sh-tile-num">{ready ? <CountUp value={blocked} /> : '…'}</span>
            <span className="sh-tile-label">Blocked</span>
            <span className="sh-tile-icon red" aria-hidden="true"><Ban size={20} /></span>
          </button>
          <div className="sh-tile">
            <span className="sh-tile-num">{ready ? <CountUp value={checked > 0 ? Math.round(avg) : 0} suffix=" ms" /> : '…'}</span>
            <span className="sh-tile-label">Average time per call</span>
            <span className="sh-tile-icon orange" aria-hidden="true"><Clock3 size={20} /></span>
          </div>
        </div>
      </section>

      {events === null ? (
        <section className="sh-card"><p className="muted">Loading your recorded requests</p></section>
      ) : (
        <>
          <BlockedRequests events={events} />
          <div className="sh-split">
            <ThisWeek events={events} />
            <RecentRequests events={events} live={connection === 'live'} onSeeAll={() => onNavigate('activity', 'audit')} />
          </div>
        </>
      )}

      <nav className="sh-links" aria-label="Shortcuts">
        <button type="button" onClick={() => onNavigate('policy', 'test')}>Test a tool call</button>
        <button type="button" onClick={() => onNavigate('security', 'threats')}>Threat Lab</button>
        <button type="button" onClick={() => onNavigate('activity', 'realtime')}>Security Center</button>
        <button type="button" onClick={() => onNavigate('activity', 'audit')}>All activity</button>
        <button type="button" onClick={() => onNavigate('overview')}>Full dashboard</button>
      </nav>

      <ProtocolXPlayground upgradeUrl={paid ? null : upgradeUrl} />
      {!paid && <ShieldLayers upgradeUrl={upgradeUrl} />}
      <PlanCompare paid={paid} upgradeUrl={upgradeUrl} />
    </div>
  );
}

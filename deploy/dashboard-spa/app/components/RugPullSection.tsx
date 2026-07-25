'use client';

import { useEffect, useState, useCallback } from 'react';

interface RugPullEvent {
  id: string;
  serverName: string;
  tenantId: string;
  previousFingerprint: string;
  currentFingerprint: string;
  toolCount: number;
  detectedAt: string;
  status: 'pending' | 'reviewed' | 'dismissed' | 'mitigated';
  reviewedAt?: string;
}

interface RugPullStatus {
  unreviewed: number;
  total: number;
  activeBlockedServers: string[];
  lastDetected: string | null;
}

interface RugPullServer {
  name: string;
  port: number;
  transport: string;
  status: string;
  localUrl: string;
  rugPullEvents: number;
  reviewedEvents: number;
  lastEvent: string | null;
  blocked: boolean;
}

function statusBadge(status: string): { label: string; variant: 'warning' | 'success' | 'neutral' | 'danger' } {
  switch (status) {
    case 'pending': return { label: 'Pending', variant: 'warning' };
    case 'reviewed': return { label: 'Reviewed', variant: 'success' };
    case 'dismissed': return { label: 'Dismissed', variant: 'neutral' };
    case 'mitigated': return { label: 'Mitigated', variant: 'success' };
    default: return { label: status, variant: 'neutral' };
  }
}

function serverStatusBadge(blocked: boolean, hasEvents: boolean): { label: string; variant: 'success' | 'danger' | 'neutral' | 'warning' } {
  if (blocked) return { label: 'Blocked', variant: 'danger' };
  if (hasEvents) return { label: 'Drift History', variant: 'warning' };
  return { label: 'Stable', variant: 'success' };
}

export default function RugPullSection() {
  const [events, setEvents] = useState<RugPullEvent[]>([]);
  const [servers, setServers] = useState<RugPullServer[]>([]);
  const [status, setStatus] = useState<RugPullStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [showServers, setShowServers] = useState(true);

  const load = useCallback(async () => {
    try {
      const [eventsRes, statusRes, serversRes] = await Promise.all([
        fetch('/api/fleet/rug-pull-events?window=168&limit=50'),
        fetch('/api/fleet/rug-pull-status'),
        fetch('/api/fleet/rug-pull-servers'),
      ]);
      if (!eventsRes.ok) throw new Error(`HTTP ${eventsRes.status}`);
      const eventsData = await eventsRes.json();
      setEvents(eventsData.events || []);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStatus(statusData);
      }
      if (serversRes.ok) {
        const serversData = await serversRes.json();
        setServers(serversData.servers || []);
      }
      setError(null);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('abort')) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const onAcknowledge = async (eventId: string) => {
    setBusy(`ack:${eventId}`);
    try {
      const res = await fetch(`/api/fleet/rug-pull-events?id=${eventId}&action=review`, { method: 'PATCH' });
      if (res.ok) await load();
    } catch { /* ignore */ }
    setBusy('');
  };

  const onDismiss = async (eventId: string) => {
    setBusy(`dismiss:${eventId}`);
    try {
      const res = await fetch(`/api/fleet/rug-pull-events?id=${eventId}&action=dismiss`, { method: 'PATCH' });
      if (res.ok) await load();
    } catch { /* ignore */ }
    setBusy('');
  };

  const onAcknowledgeAll = async () => {
    setBusy('ack-all');
    const pending = events.filter(e => e.status === 'pending');
    for (const e of pending) {
      try {
        await fetch(`/api/fleet/rug-pull-events?id=${e.id}&action=review`, { method: 'PATCH' });
      } catch { break; }
    }
    await load();
    setBusy('');
  };

  const onClearResolved = async () => {
    setBusy('clear');
    try {
      await fetch('/api/fleet/rug-pull-events?server=', { method: 'DELETE' });
      await load();
    } catch { /* ignore */ }
    setBusy('');
  };

  const onTriggerScan = async () => {
    setBusy('scan');
    try {
      const res = await fetch('/api/fleet/rug-pull-events/scan', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.newDetections > 0) {
          alert(`Scan complete: ${data.newDetections} new drift detections across ${data.serversChecked} servers.`);
        } else {
          alert(`Scan complete: No new drift detected across ${data.serversChecked} servers.`);
        }
      }
      await load();
    } catch { /* ignore */ }
    setBusy('');
  };

  if (loading) {
    return (
      <div className="panel" style={{ marginTop: 'var(--space-6)' }}>
        <div className="panel-body">
          <p className="text-sm text-muted">Loading rug-pull events...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel" style={{ marginTop: 'var(--space-6)' }}>
        <div className="panel-body">
          <div className="banner banner-warning">Rug-pull data unavailable. Ensure the proxy is running with tool fingerprinting enabled.</div>
        </div>
      </div>
    );
  }

  const pendingEvents = events.filter(e => e.status === 'pending');
  const reviewedEvents = events.filter(e => e.status !== 'pending');

  return (
    <div className="panel" style={{ marginTop: 'var(--space-6)' }}>
      <div className="panel-header">
        <h2 className="panel-title">Rug-Pull Detection</h2>
        <p className="text-sm text-muted">OWASP MCP03 -- tool-definition drift monitoring. A mismatch means the MCP server changed its tools mid-session, a potential supply-chain attack.</p>
      </div>
      <div className="panel-body">
        {status && (
          <div className="kpi-grid" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="kpi-card">
              <div className="kpi-label">Unreviewed</div>
              <div className="kpi-value" style={{ color: status.unreviewed > 0 ? 'var(--danger)' : 'var(--success)' }}>{status.unreviewed}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Active Blocked Servers</div>
              <div className="kpi-value" style={{ color: status.activeBlockedServers.length > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{status.activeBlockedServers.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total Events</div>
              <div className="kpi-value">{status.total}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Last Detected</div>
              <div className="kpi-value" style={{ fontSize: 'var(--text-sm)' }}>
                {status.lastDetected ? new Date(status.lastDetected).toLocaleTimeString() : '--'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Fleet Servers</div>
              <div className="kpi-value">{servers.length}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap" style={{ marginBottom: 'var(--space-4)' }}>
          {pendingEvents.length > 0 && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onAcknowledgeAll}
              disabled={busy === 'ack-all'}
            >
              {busy === 'ack-all' ? 'Acknowledging...' : `Acknowledge All (${pendingEvents.length})`}
            </button>
          )}
          {reviewedEvents.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClearResolved}
              disabled={busy === 'clear'}
            >
              {busy === 'clear' ? 'Clearing...' : 'Clear Resolved'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onTriggerScan}
            disabled={busy === 'scan'}
          >
            {busy === 'scan' ? 'Scanning...' : 'Trigger Manual Scan'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowServers(!showServers)}
          >
            {showServers ? 'Hide Server List' : 'Show All Servers'}
          </button>
        </div>

        {showServers && servers.length > 0 && (
          <>
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Fleet Server Status ({servers.length})</h3>
            <div className="table-wrap" style={{ marginBottom: 'var(--space-4)' }}>
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Server</th>
                    <th>Transport</th>
                    <th>Port</th>
                    <th>Status</th>
                    <th>Events</th>
                    <th>Last Event</th>
                  </tr>
                </thead>
                <tbody>
                  {servers.map((s) => {
                    const badge = serverStatusBadge(s.blocked, s.rugPullEvents + s.reviewedEvents > 0);
                    return (
                      <tr key={s.name}>
                        <td><strong className="text-sm">{s.name}</strong></td>
                        <td><span className="text-xs">{s.transport}</span></td>
                        <td><code className="text-xs mono">{s.port}</code></td>
                        <td><span className={`badge badge-${badge.variant}`}>{badge.label}</span></td>
                        <td className="text-sm">
                          {s.rugPullEvents + s.reviewedEvents > 0
                            ? `${s.rugPullEvents} pending / ${s.reviewedEvents} reviewed`
                            : 'None'}
                        </td>
                        <td className="text-sm">{s.lastEvent ? new Date(s.lastEvent).toLocaleString() : '--'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {events.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">No tool-definition drift detected</p>
            <p className="empty-state-desc">All {servers.length} MCP server fingerprints are stable. No OWASP MCP03 violations. Click Trigger Manual Scan to proactively check all registered servers.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Drift Events</h3>
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Previous Fingerprint</th>
                  <th>New Fingerprint</th>
                  <th>Tools</th>
                  <th>Detected</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const badge = statusBadge(e.status);
                  return (
                    <tr key={e.id} className={e.status === 'pending' ? 'row-warning' : undefined}>
                      <td><strong className="text-sm">{e.serverName}</strong></td>
                      <td><code className="text-xs mono">{e.previousFingerprint}</code></td>
                      <td><code className="text-xs mono" style={{ color: 'var(--danger)' }}>{e.currentFingerprint}</code></td>
                      <td className="text-sm">{e.toolCount}</td>
                      <td className="text-sm">{new Date(e.detectedAt).toLocaleString()}</td>
                      <td><span className={`badge badge-${badge.variant}`}>{badge.label}</span></td>
                      <td>
                        <div className="flex gap-2">
                          {e.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => onAcknowledge(e.id)}
                                disabled={busy === `ack:${e.id}`}
                              >
                                {busy === `ack:${e.id}` ? '...' : 'Ack'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => onDismiss(e.id)}
                                disabled={busy === `dismiss:${e.id}`}
                              >
                                {busy === `dismiss:${e.id}` ? '...' : 'Dismiss'}
                              </button>
                            </>
                          )}
                          {e.status !== 'pending' && e.status !== 'dismissed' && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => onDismiss(e.id)}
                              disabled={busy === `dismiss:${e.id}`}
                            >
                              Dismiss
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

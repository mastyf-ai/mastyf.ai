'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAggregateMetrics,
  fetchAudit,
  fetchAuthStatus,
  fetchCost,
  fetchHealth,
  fetchFleetInstances,
  fetchSecurity,
  rejectFp,
  type FleetInstance,
  type AuditResponse,
  type AggregateMetrics,
  type CostResponse,
  type HealthResponse,
  type SecurityResponse,
} from '@/lib/guardian-api';
import { useDashboardWs } from '@/lib/use-dashboard-ws';
import { DashboardShell } from './DashboardShell';
import { LoginGate } from './LoginGate';
import { AgentFlowPanel } from './AgentFlowPanel';
import { SetupPanel } from './SetupPanel';
import { SwarmPanel } from './SwarmPanel';
import { AiLearningPanel } from './AiLearningPanel';
import { PolicyPanel } from './PolicyPanel';
import { AdminPanel } from './AdminPanel';
import { TenantContextBar } from './TenantContextBar';
import { hasPermission } from '@/lib/dashboard-roles';
import type { AuthStatus } from '@/lib/guardian-api';

type TabId =
  | 'setup'
  | 'flow'
  | 'overview'
  | 'audit'
  | 'security'
  | 'cost'
  | 'health'
  | 'ai'
  | 'policy'
  | 'fleet'
  | 'swarm'
  | 'admin';

const TABS: { id: TabId; label: string }[] = [
  { id: 'setup', label: 'Setup' },
  { id: 'flow', label: 'Agent flow' },
  { id: 'overview', label: 'Overview' },
  { id: 'audit', label: 'Live audit' },
  { id: 'security', label: 'Security' },
  { id: 'cost', label: 'Cost' },
  { id: 'health', label: 'Health' },
  { id: 'ai', label: 'AI copilot' },
  { id: 'policy', label: 'Policy' },
  { id: 'fleet', label: 'Fleet' },
  { id: 'swarm', label: 'Analysis' },
  { id: 'admin', label: 'Admin' },
];

const POLL_FAILURES_BEFORE_DOWN = 3;
const STATUS_DEBOUNCE_MS = 400;
const REST_POLL_MS = 30_000;

export function DashboardClient() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<TabId>('flow');
  const [status, setStatus] = useState('Loading…');
  const [statusIsError, setStatusIsError] = useState(false);
  const [apiUnreachable, setApiUnreachable] = useState(false);

  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [metrics, setMetrics] = useState<AggregateMetrics | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);
  const [security, setSecurity] = useState<SecurityResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [fleet, setFleet] = useState<FleetInstance[]>([]);
  const [actionMsg, setActionMsg] = useState('');
  const [sessionKey, setSessionKey] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [auditAction, setAuditAction] = useState('');
  const [auditServer, setAuditServer] = useState('');

  const pollFailuresRef = useRef(0);
  const statusTimerRef = useRef<number | null>(null);

  const ws = useDashboardWs(ready, sessionKey);

  const applyStatus = useCallback((text: string, isError: boolean, immediate = false) => {
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    const apply = () => {
      setStatus(text);
      setStatusIsError(isError);
    };
    if (immediate) {
      apply();
      return;
    }
    statusTimerRef.current = window.setTimeout(apply, STATUS_DEBOUNCE_MS);
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [auditRes, metricsRes, costRes, secRes, healthRes, fleetRes, authRes] =
        await Promise.all([
          fetchAudit({
            limit: 100,
            action: auditAction || undefined,
            server: auditServer || undefined,
          }),
          fetchAggregateMetrics(),
          fetchCost(),
          fetchSecurity(),
          fetchHealth(),
          fetchFleetInstances(),
          fetchAuthStatus(),
        ]);
      if (authRes) {
        setAuthStatus(authRes);
        if (authRes.roles) setRoles(authRes.roles);
      }

      if (!auditRes && !metricsRes && !costRes) {
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= POLL_FAILURES_BEFORE_DOWN) {
          setApiUnreachable(true);
          if (!ws.connected) {
            applyStatus(
              'API unavailable — check DASHBOARD_ENABLED on :4000, auth, or rate limit (429)',
              true,
            );
          }
        }
        return;
      }

      pollFailuresRef.current = 0;
      setApiUnreachable(false);
      if (!ws.connected) {
        applyStatus('Connected — live data from proxy history DB', false);
      } else {
        applyStatus(ws.statusText, ws.statusIsError);
      }
      if (auditRes) setAudit(auditRes);
      if (metricsRes) setMetrics(metricsRes);
      if (costRes) setCost(costRes);
      if (secRes) setSecurity(secRes);
      if (healthRes) setHealth(healthRes);
      setFleet(fleetRes);
    } catch (e) {
      pollFailuresRef.current += 1;
      const message = e instanceof Error ? e.message : 'Network error';
      if (pollFailuresRef.current >= POLL_FAILURES_BEFORE_DOWN) {
        setApiUnreachable(true);
        if (!ws.connected) {
          applyStatus(`REST error: ${message}`, true);
        }
      }
    }
  }, [applyStatus, auditAction, auditServer, ws.connected, ws.statusText, ws.statusIsError]);

  useEffect(() => {
    setReady(true);
  }, []);

  const onAuthenticated = useCallback(() => {
    setSessionKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refreshAll();
    const interval = window.setInterval(() => void refreshAll(), REST_POLL_MS);
    return () => window.clearInterval(interval);
  }, [ready, sessionKey, refreshAll]);

  useEffect(() => {
    if (ws.connected) {
      applyStatus(ws.statusText, ws.statusIsError, true);
    }
  }, [ws.connected, ws.statusText, ws.statusIsError, applyStatus]);

  useEffect(() => {
    if (ws.metricsPatch) setMetrics(ws.metricsPatch);
  }, [ws.metricsPatch]);

  useEffect(() => {
    if (ws.auditPatch) setAudit((prev) => ({ ...prev, ...ws.auditPatch! }));
  }, [ws.auditPatch]);

  const onFpReject = async (rule: string, pattern: string) => {
    if (!hasPermission(roles, 'policy_mutate')) {
      setActionMsg('Requires operator role for FP reject');
      return;
    }
    const res = await rejectFp({ rule, pattern: pattern || rule });
    setActionMsg(res.ok ? 'FP rejection recorded' : res.error || 'FP reject failed');
    if (res.ok) await refreshAll();
  };

  if (!ready) {
    return <DashboardShell />;
  }

  const displayMetrics = metrics ?? ws.metricsPatch;
  const displayAudit = audit;

  const blockedPct =
    displayAudit && displayAudit.total > 0
      ? Math.round((displayAudit.blocked / displayAudit.total) * 100)
      : 0;

  const lastBlocked = (displayAudit?.events || []).find((e) => e.action === 'block');

  return (
    <LoginGate onAuthenticated={onAuthenticated}>
    <main>
      <header>
        <h1>MCP Guardian</h1>
        <p className={statusIsError ? 'status status-error' : 'status'} suppressHydrationWarning>
          {status}
        </p>
        <p className="subtitle">Data-authentic agentic SOC — metrics from real proxy call_records</p>
        <TenantContextBar authStatus={authStatus} />
      </header>

      {apiUnreachable && <MotionlessBanner />}
      {actionMsg ? <p className="action-msg">{actionMsg}</p> : null}

      <nav className="tabs" aria-label="Dashboard sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'tab active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'setup' && <SetupPanel onGoToAgentFlow={() => setTab('flow')} />}

      {tab === 'flow' && <AgentFlowPanel ws={ws} roles={roles} />}

      {tab === 'overview' && (
        <section className="cards" aria-label="Overview metrics">
          <article className="card">
            <h2>Total calls</h2>
            <p className="metric">{displayMetrics?.totalRequests ?? displayAudit?.total ?? '—'}</p>
          </article>
          <article className="card">
            <h2>Pass rate</h2>
            <p className="metric">
              {displayMetrics?.passRate != null
                ? `${displayMetrics.passRate.toFixed(1)}%`
                : displayAudit && displayAudit.total > 0
                  ? `${(100 - blockedPct).toFixed(1)}%`
                  : '—'}
            </p>
          </article>
          <article className="card">
            <h2>Avg latency</h2>
            <p className="metric">
              {displayMetrics?.avgLatencyMs != null
                ? `${displayMetrics.avgLatencyMs.toFixed(0)} ms`
                : '—'}
            </p>
          </article>
          <article className="card">
            <h2>Cost (USD)</h2>
            <p className="metric">
              {displayMetrics?.totalCost != null || cost?.totalCost != null
                ? `$${(displayMetrics?.totalCost ?? cost?.totalCost ?? 0).toFixed(4)}`
                : '—'}
            </p>
          </article>
          <article className="card">
            <h2>Burn rate / hr</h2>
            <p className="metric">
              {displayMetrics?.burnRatePerHour != null
                ? `$${displayMetrics.burnRatePerHour.toFixed(4)}`
                : '—'}
            </p>
          </article>
          <article className="card">
            <h2>Semantic flags</h2>
            <p className="metric">
              {displayAudit?.flagged ?? displayAudit?.semanticAudit?.flagged ?? 0}
            </p>
            {displayAudit?.semanticAudit?.enabled ? (
              <p className="hint">
                Queue {displayAudit.semanticAudit.queued} · processed{' '}
                {displayAudit.semanticAudit.processed}
              </p>
            ) : null}
          </article>
          {displayMetrics?.lastUpdated ? (
            <p className="hint overview-updated">Last updated {displayMetrics.lastUpdated}</p>
          ) : null}
        </section>
      )}

      {tab === 'audit' && (
        <section>
          <h2>Live audit trail</h2>
          <p className="hint">Source: /api/aggregate/audit (history.db call_records)</p>
          <div className="filter-row">
            <label className="inline">
              Action
              <select
                value={auditAction}
                onChange={(e) => setAuditAction(e.target.value)}
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
                onChange={(e) => setAuditServer(e.target.value)}
              />
            </label>
            <button type="button" className="secondary" onClick={() => void refreshAll()}>
              Apply filters
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Server</th>
                <th>Tool</th>
                <th>Action</th>
                <th>Rule</th>
                <th>Reason</th>
                <th>Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(displayAudit?.events || []).slice(0, 50).map((e, i) => (
                <tr key={`${e.timestamp}-${i}`} className={e.action === 'block' ? 'row-block' : undefined}>
                  <td>{e.timestamp?.slice(11, 19) || '—'}</td>
                  <td>{e.server_name || '—'}</td>
                  <td>{e.tool_name}</td>
                  <td>{e.action}</td>
                  <td>{e.rule || '—'}</td>
                  <td className="cell-reason" title={e.reason || ''}>
                    {(e.reason || '—').slice(0, 48)}
                    {(e.reason?.length ?? 0) > 48 ? '…' : ''}
                  </td>
                  <td>{e.cost_usd != null ? `$${e.cost_usd.toFixed(4)}` : '—'}</td>
                  <td>
                    {e.action === 'block' && e.rule ? (
                      <button
                        type="button"
                        className="secondary btn-sm"
                        title="FP whitelist (3-strike)"
                        onClick={() =>
                          void onFpReject(e.rule || '', e.reason || e.tool_name || '')
                        }
                      >
                        FP reject
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            Showing {(displayAudit?.events || []).length} of {displayAudit?.total ?? 0} · blocked{' '}
            {displayAudit?.blocked ?? 0} · passed {displayAudit?.passed ?? 0}. Live stream on{' '}
            <button type="button" className="linkish" onClick={() => setTab('flow')}>
              Agent flow
            </button>
            .
          </p>
        </section>
      )}

      {tab === 'security' && (
        <section>
          <h2>Security scans</h2>
          {!security ? (
            <p className="muted">No security scan data — run scan via CLI or wait for proxy traffic.</p>
          ) : (
            <>
              <p className="metric-inline">
                Score: {security.overallScore != null ? `${security.overallScore} / 100` : '—'}
              </p>
              <ul className="list">
                {(security.serverReports || []).map((s) => (
                  <li key={s.name}>
                    {s.scanned === false
                      ? `${s.name}: no scan yet`
                      : `${s.name}: score ${s.score ?? '—'}, critical ${s.critical ?? '—'}, high ${s.high ?? '—'}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {tab === 'cost' && (
        <section>
          <h2>Cost governance</h2>
          {!cost ? (
            <p className="muted">No cost data — connect proxy history DB.</p>
          ) : (
            <>
              <p className="metric-inline">
                Total: {cost.totalCost != null ? `$${cost.totalCost.toFixed(4)}` : '—'}
              </p>
              {(cost.budgetAlerts || []).map((a) => (
                <p key={a} className="alert">
                  {a}
                </p>
              ))}
            </>
          )}
        </section>
      )}

      {tab === 'health' && (
        <section>
          <h2>Health</h2>
          {!health ? (
            <p className="muted">No health data — connect proxy history DB.</p>
          ) : (
            <ul className="list">
              {(health.serverReports || []).map((h) => (
                <li key={h.name}>
                  {h.name}: {h.latency}ms, CB {h.circuitBreaker}, success{' '}
                  {h.successRate != null ? `${h.successRate}%` : '—'}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'ai' && (
        <AiLearningPanel
          roles={roles}
          refreshTick={ws.aiRefreshTick}
          onAction={(m) => setActionMsg(m)}
        />
      )}

      {tab === 'policy' && (
        <PolicyPanel
          roles={roles}
          lastBlocked={lastBlocked ?? null}
          onAction={(m) => setActionMsg(m)}
        />
      )}

      {tab === 'swarm' && (
        <SwarmPanel pipeline={ws.pipeline} swarmDoneTick={ws.swarmDoneTick} />
      )}

      {tab === 'admin' && (
        <AdminPanel roles={roles} tenantLocked={!!authStatus?.tenantLocked} />
      )}

      {tab === 'fleet' && (
        <section>
          <h2>Fleet instances</h2>
          <p className="hint">Postgres / GUARDIAN_FLEET_DB_PATHS / GUARDIAN_TELEMETRY_ENDPOINTS</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Status</th>
                <th>Requests</th>
                <th>Blocked</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((i) => (
                <tr key={i.instanceId}>
                  <td>{i.instanceName || i.instanceId}</td>
                  <td>{i.status || '—'}</td>
                  <td>{i.totalRequests ?? '—'}</td>
                  <td>{i.blockedRequests ?? '—'}</td>
                  <td>{i.fleetSource || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

    </main>
    </LoginGate>
  );
}

function MotionlessBanner() {
  return (
    <div className="banner" role="status">
      Guardian API not reachable (or rate-limited). Run the proxy with{' '}
      <code>DASHBOARD_ENABLED=true</code> on port 4000, restart after{' '}
      <code>pnpm dashboard:build</code>, or set{' '}
      <code>?apiBase=http://localhost:4000</code> (and <code>apiKey=</code> if required). If you
      see HTTP 429 in the network tab, refresh after a minute or raise{' '}
      <code>GUARDIAN_DASHBOARD_API_RATE_LIMIT</code>.
    </div>
  );
}

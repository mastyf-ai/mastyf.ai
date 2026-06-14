'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acceptThreatLabCandidate,
  dismissThreatIntel,
  fetchHealth,
  fetchQuarantinedThreats,
  fetchSecurity,
  fetchSecurityDashboard,
  fetchSecurityQuarantinedThreats,
  fetchSwarmLatest,
  fetchThreatDiscoveryStatus,
  fetchThreatLabCandidates,
  quarantineAllThreats,
  quarantineSecurityThreat,
  rejectThreatLabCandidate,
  restoreSecurityThreat,
  restoreThreatIntel,
  runSecuritySwarm,
  runThreatLab,
  runAutoThreatResearch,
  type HealthResponse,
  type QuarantineRecord,
  type SecurityDashboardResponse,
  type SecurityDashboardThreat,
  type SecurityMonitorQuarantineRecord,
  type SecurityResponse,
  type ThreatDiscoveryStatus,
  type ThreatLabCandidate,
} from '@/lib/mastyf-ai-api';
import { hasPermission } from '@/lib/dashboard-roles';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge, SeverityBadge } from '../ui/Badge';
import { KpiCard } from '../ui/KpiCard';
import { EmptyState } from '../ui/EmptyState';
import { WorkspaceSubNav } from '../ui/WorkspaceSubNav';

type SecurityView = 'overview' | 'threats' | 'intel' | 'quarantine';

type Props = {
  view: SecurityView;
  onViewChange: (v: SecurityView) => void;
  roles?: string[];
  refreshKey: number;
  onAction?: (msg: string) => void;
};

const WINDOW_DAYS = 1;

const VIEW_TABS = [
  { id: 'overview' as const, label: 'Posture Overview' },
  { id: 'threats' as const, label: 'Threat Detection' },
  { id: 'intel' as const, label: 'Threat Intel' },
  { id: 'quarantine' as const, label: 'Quarantine' },
];

function scoreLevel(score: number | null): 'good' | 'fair' | 'poor' {
  if (score == null) return 'poor';
  if (score >= 80) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/* ── Overview ──────────────────────────────────── */

function OverviewView({ roles, refreshKey, onAction }: { roles: string[]; refreshKey: number; onAction?: (msg: string) => void }) {
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [dash, setDash] = useState<SecurityDashboardResponse | null>(null);
  const [sec, setSec] = useState<SecurityResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [dashData, secData, healthData] = await Promise.all([
      fetchSecurityDashboard('24h'),
      fetchSecurity(),
      fetchHealth(),
    ]);
    setDash(dashData);
    setSec(secData);
    setHealth(healthData);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const score = dash?.securityScore ?? sec?.overallScore ?? null;
  const level = scoreLevel(score);
  const activeThreats = dash?.activeThreatCount ?? sec?.activeThreats ?? 0;
  const serverCount = sec?.serverReports?.length ?? health?.serverReports?.length ?? 0;

  const onQuarantineAll = async () => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    const count = (dash?.threats ?? []).filter(t => t.severity === 'critical' || t.severity === 'high').length;
    if (!count) { onAction?.('No high-severity threats to quarantine'); return; }
    if (!window.confirm(`Quarantine ${count} high/critical threat(s)?`)) return;
    setBusy('quarantine-all');
    const res = await quarantineAllThreats();
    if (res.ok) {
      onAction?.(`Quarantined ${res.quarantined ?? 0} threat(s)`);
      await load();
    } else {
      onAction?.(res.error || 'Quarantine failed');
    }
    setBusy('');
  };

  const onQuarantineOne = async (row: SecurityDashboardThreat) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    if (!window.confirm(`Quarantine ${row.id}?`)) return;
    setBusy(row.id);
    const res = await quarantineSecurityThreat(row);
    if (res.ok) {
      onAction?.(`Quarantined ${row.id}`);
      await load();
    } else {
      onAction?.(res.error || 'Quarantine failed');
    }
    setBusy('');
  };

  return (
    <>
      <div className="kpi-grid">
        <KpiCard
          label="Security Score"
          value={score != null ? `${score}/100` : '—'}
          accent={level === 'good' ? 'success' : level === 'fair' ? 'warning' : 'danger'}
        />
        <KpiCard
          label="Active Threats"
          value={activeThreats}
          accent={activeThreats > 0 ? 'danger' : 'success'}
          secondary={activeThreats > 0 ? 'Requires attention' : 'All clear'}
        />
        <KpiCard label="Servers Monitored" value={serverCount} accent="info" />
        <KpiCard
          label="Last Scan"
          value={sec?.lastScan ? formatTs(sec.lastScan) : dash?.generatedAt ? formatTs(dash.generatedAt) : '—'}
          accent="neutral"
        />
      </div>

      <div className="grid grid-12">
        <div className="col-span-8">
          <div className="grid grid-12" style={{ marginBottom: 'var(--space-5)' }}>
            <div className="col-span-6">
              <Card title="Threat Layers" subtitle="Current security posture by layer">
                {dash?.layers && dash.layers.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {dash.layers.map(l => (
                      <div key={l.id} className="flex items-center gap-3 text-sm">
                        <span
                          style={{
                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                            background: l.status === 'secure' ? 'var(--success)' : l.status === 'alert' ? 'var(--danger)' : 'var(--warning)',
                          }}
                        />
                        <span style={{ flex: 1 }}>{l.label}</span>
                        <Badge variant={l.status === 'secure' ? 'success' : 'warning'}>{l.status}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">No layer data available</p>
                )}
              </Card>
            </div>
            <div className="col-span-6">
              <Card title="Executive Summary">
                {dash?.executiveSummary && dash.executiveSummary.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--leading-relaxed)' }}>
                    {dash.executiveSummary.map((line, i) => (
                      <li key={i} style={{ marginBottom: 'var(--space-1)' }}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No summary available</p>
                )}
              </Card>
            </div>
          </div>

          <Card
            title="Active Threats"
            subtitle={dash?.threats ? `${dash.threats.length} detected` : undefined}
            actions={
              <div className="flex gap-2">
                <Button variant="danger" size="sm" onClick={() => void onQuarantineAll()} disabled={!!busy || !canMutate}>
                  {busy === 'quarantine-all' ? '…' : 'Quarantine All'}
                </Button>
              </div>
            }
          >
            {loading ? (
              <p className="text-sm text-muted">Loading threats…</p>
            ) : !dash?.threats || dash.threats.length === 0 ? (
              <EmptyState title="No threats" message="All clear — no active threats detected" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Type</th>
                      <th>Source</th>
                      <th>Severity</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {dash.threats.slice(0, 10).map(t => (
                      <tr key={t.id} className={t.severity === 'critical' || t.severity === 'high' ? 'row-critical' : t.severity === 'medium' ? 'row-warning' : ''}>
                        <td><code className="text-xs">{t.id}</code></td>
                        <td>{t.type}</td>
                        <td>{t.source}</td>
                        <td><SeverityBadge severity={t.severity} /></td>
                        <td><Badge variant={t.status === 'blocked' ? 'danger' : t.status === 'monitored' ? 'warning' : 'success'}>{t.status}</Badge></td>
                        <td>
                          {canMutate ? (
                            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void onQuarantineOne(t)}>
                              {busy === t.id ? '…' : 'Quarantine'}
                            </Button>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="col-span-4">
          <Card title="Server Posture" subtitle="Security score by server">
            {sec?.serverReports && sec.serverReports.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sec.serverReports.map(s => (
                  <div key={s.name} className="flex items-center gap-3 text-sm">
                    <span className="truncate" style={{ flex: 1 }}>{s.name}</span>
                    <Badge variant={
                      s.score == null ? 'neutral' :
                      s.score >= 80 ? 'success' :
                      s.score >= 50 ? 'warning' : 'danger'
                    }>
                      {s.score != null ? `${s.score}` : '—'}
                    </Badge>
                    {(s.critical ?? 0) > 0 && <Badge variant="danger">{s.critical}C</Badge>}
                    {(s.high ?? 0) > 0 && <Badge variant="warning">{s.high}H</Badge>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No server reports</p>
            )}
          </Card>

          <div className="section">
            <Card title="Risk Gauge">
              <div className="risk-gauge">
                <div className={`risk-gauge-ring ${level}`}>
                  <span>{score != null ? score : '—'}</span>
                </div>
                <div className="risk-gauge-info">
                  <span className="risk-gauge-label">Security Score</span>
                  <span className="risk-gauge-value">
                    {score != null ? (
                      score >= 80 ? 'Good' : score >= 50 ? 'Fair' : 'Needs Attention'
                    ) : 'Unknown'}
                  </span>
                  <span className="text-xs text-muted">
                    {activeThreats > 0 ? `${activeThreats} active threats` : 'No threats detected'}
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Threats ───────────────────────────────────── */

function ThreatsView({ roles, refreshKey, onAction }: { roles: string[]; refreshKey: number; onAction?: (msg: string) => void }) {
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [status, setStatus] = useState<ThreatDiscoveryStatus | null>(null);
  const [candidates, setCandidates] = useState<ThreatLabCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    const [statusRes, labRes] = await Promise.all([
      fetchThreatDiscoveryStatus(),
      fetchThreatLabCandidates(),
    ]);
    setStatus(statusRes.status);
    if (statusRes.error) setErr(statusRes.error);
    setCandidates(labRes);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const onRunAnalysis = async () => {
    setBusy('run');
    const res = await runSecuritySwarm();
    if (res?.ok) {
      onAction?.(`Analysis started — job ${res.jobId}`);
    } else {
      onAction?.(res?.error || 'Failed to start analysis');
    }
    setBusy('');
  };

  const onRunThreatLab = async () => {
    setBusy('threat-lab');
    const res = await runThreatLab();
    if (res.ok) {
      onAction?.(`Threat Lab started — job ${res.jobId}`);
    } else {
      onAction?.(res.error || 'Failed to start Threat Lab');
    }
    setBusy('');
  };

  const onAutoResearch = async () => {
    setBusy('auto');
    const res = await runAutoThreatResearch();
    if (res.ok) {
      onAction?.(`Auto Research started — job ${res.jobId}`);
    } else {
      onAction?.(res.error || 'Failed to start Auto Research');
    }
    setBusy('');
  };

  const onAccept = async (id: string) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    setBusy(`accept:${id}`);
    const ok = await acceptThreatLabCandidate(id);
    if (ok) {
      onAction?.(`Accepted candidate ${id}`);
      await load();
    } else {
      onAction?.(`Failed to accept ${id}`);
    }
    setBusy('');
  };

  const onReject = async (id: string) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    setBusy(`reject:${id}`);
    const ok = await rejectThreatLabCandidate(id);
    if (ok) {
      onAction?.(`Rejected candidate ${id}`);
      await load();
    } else {
      onAction?.(`Failed to reject ${id}`);
    }
    setBusy('');
  };

  const pipeline = status?.pipeline;

  const pendingCandidates = candidates.filter(c => c.reviewStatus === 'pending' || !c.reviewStatus);

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Pipeline Queue" value={pipeline?.queued ?? 0} accent="info" />
        <KpiCard label="Fingerprints Processed" value={status?.processedFingerprints ?? 0} accent="success" />
        <KpiCard label="Pipeline" value={pipeline?.enabled ? 'Enabled' : 'Disabled'} accent={pipeline?.enabled ? 'success' : 'danger'} />
        <KpiCard label="Pending Review" value={pendingCandidates.length} accent={pendingCandidates.length > 0 ? 'warning' : 'neutral'} />
      </div>

      <div className="grid grid-12" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="col-span-8">
          <Card title="Discovery Pipeline" subtitle="Threat detection pipeline status">
            {loading ? (
              <p className="text-sm text-muted">Loading pipeline…</p>
            ) : pipeline ? (
              <div className="flex gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Queue:</span>
                  <span className="font-semibold">{pipeline.queued}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Writes/hr:</span>
                  <span className="font-semibold">{pipeline.writesThisHour} / {pipeline.maxPerHour}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Sources:</span>
                  <Badge variant={pipeline.sources.semantic ? 'success' : 'neutral'}>Semantic</Badge>
                  <Badge variant={pipeline.sources.blocks ? 'success' : 'neutral'}>Blocks</Badge>
                  <Badge variant={pipeline.sources.threatIntel ? 'success' : 'neutral'}>Intel</Badge>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Pipeline status unavailable</p>
            )}
          </Card>

          <Card
            title="Threat Lab Candidates"
            subtitle={pendingCandidates.length > 0 ? `${pendingCandidates.length} pending review` : undefined}
          >
            {loading ? (
              <p className="text-sm text-muted">Loading candidates…</p>
            ) : candidates.length === 0 ? (
              <EmptyState title="No candidates" message="No threat lab candidates found. Run an analysis to generate candidates." />
            ) : (
              <div className="grid grid-2" style={{ gap: 'var(--space-3)' }}>
                {candidates.map(c => (
                  <div key={c.id} style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-4)',
                  }}>
                    <div className="flex items-center gap-3 mb-2">
                      <SeverityBadge severity={
                        c.confidence >= 0.7 ? 'HIGH' : c.confidence >= 0.4 ? 'MEDIUM' : 'LOW'
                      } />
                      <span className="font-semibold text-sm">{(c.confidence * 100).toFixed(0)}% confidence</span>
                      <Badge variant={c.reviewStatus === 'accepted' ? 'success' : c.reviewStatus === 'rejected' ? 'danger' : 'warning'}>
                        {c.reviewStatus || 'pending'}
                      </Badge>
                    </div>
                    <p className="font-medium text-sm mb-1">{c.attackClass}</p>
                    <p className="text-xs text-muted mb-2">{c.hypothesis.slice(0, 180)}</p>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      {c.provenance?.source && <span>{c.provenance.source}</span>}
                    </div>
                    {(!c.reviewStatus || c.reviewStatus === 'pending') && canMutate && (
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void onAccept(c.id)}>
                          {busy === `accept:${c.id}` ? '…' : 'Accept'}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void onReject(c.id)}>
                          {busy === `reject:${c.id}` ? '…' : 'Reject'}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="col-span-4">
          <Card title="Quick Actions">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button variant="primary" onClick={onRunAnalysis} disabled={!!busy}>
                {busy === 'run' ? 'Running…' : 'Run Analysis'}
              </Button>
              <Button variant="secondary" onClick={onRunThreatLab} disabled={!!busy}>
                {busy === 'threat-lab' ? 'Starting…' : 'Threat Lab'}
              </Button>
              <Button variant="secondary" onClick={onAutoResearch} disabled={!!busy}>
                {busy === 'auto' ? 'Starting…' : 'Auto Research'}
              </Button>
              <Button variant="ghost" onClick={() => void load()} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </Card>

          {err && (
            <div className="banner banner-warning" style={{ marginTop: 'var(--space-4)' }}>
              <div className="banner-content">{err}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Intel ─────────────────────────────────────── */

function IntelView({ roles, refreshKey, onAction }: { roles: string[]; refreshKey: number; onAction?: (msg: string) => void }) {
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [findings, setFindings] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<ThreatLabCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [swarm, lab] = await Promise.all([
      fetchSwarmLatest(),
      fetchThreatLabCandidates(),
    ]);
    setFindings(swarm?.findings ?? []);
    setCandidates(lab);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const onDismiss = async (id: string) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    setBusy(`dismiss:${id}`);
    const res = await dismissThreatIntel(id);
    if (res.ok) {
      onAction?.(`Dismissed ${id}`);
      await load();
    } else {
      onAction?.(res.error || 'Failed to dismiss');
    }
    setBusy('');
  };

  const merged = useMemo(() => {
    const items: { id: string; source: string; summary: string; severity: string; kind: 'swarm' | 'candidate' }[] = [];
    for (const f of findings ?? []) {
      items.push({ id: `swarm-${items.length}`, source: f.source, summary: f.summary, severity: f.severity, kind: 'swarm' });
    }
    for (const c of candidates) {
      items.push({
        id: c.id,
        source: c.provenance?.source || 'threat-lab',
        summary: c.hypothesis,
        severity: c.confidence >= 0.7 ? 'HIGH' : c.confidence >= 0.4 ? 'MEDIUM' : 'LOW',
        kind: 'candidate',
      });
    }
    const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    items.sort((a, b) => (order[a.severity.toUpperCase()] ?? 4) - (order[b.severity.toUpperCase()] ?? 4));
    return items;
  }, [findings, candidates]);

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Total Intel Items" value={merged.length} accent="info" />
        <KpiCard label="Critical" value={merged.filter(i => i.severity.toUpperCase() === 'CRITICAL').length} accent="danger" />
        <KpiCard label="High" value={merged.filter(i => i.severity.toUpperCase() === 'HIGH').length} accent="warning" />
        <KpiCard label="Swarm Findings" value={findings.length} accent="info" />
      </div>

      <Card
        title="Live Threat Intelligence Feed"
        subtitle={`${merged.length} item(s) — sorted by severity`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </Button>
        }
      >
        {loading ? (
          <p className="text-sm text-muted">Loading feed…</p>
        ) : merged.length === 0 ? (
          <EmptyState title="No intel" message="No threat intelligence findings available" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Source</th>
                  <th>Kind</th>
                  <th>Summary</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {merged.map(item => (
                  <tr key={item.id} className={
                    item.severity.toUpperCase() === 'CRITICAL' ? 'row-critical' :
                    item.severity.toUpperCase() === 'HIGH' ? 'row-warning' : ''
                  }>
                    <td><SeverityBadge severity={item.severity} /></td>
                    <td className="text-sm">{item.source}</td>
                    <td><Badge variant={item.kind === 'swarm' ? 'info' : 'warning'}>{item.kind}</Badge></td>
                    <td className="text-sm">{item.summary}</td>
                    <td>
                      {canMutate && item.kind !== 'candidate' ? (
                        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void onDismiss(item.id)}>
                          {busy === `dismiss:${item.id}` ? '…' : 'Dismiss'}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* ── Quarantine ──────────────────────────────────── */

function QuarantineView({ roles, refreshKey, onAction }: { roles: string[]; refreshKey: number; onAction?: (msg: string) => void }) {
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [monitorRows, setMonitorRows] = useState<SecurityMonitorQuarantineRecord[]>([]);
  const [intelRows, setIntelRows] = useState<QuarantineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [monitor, intel] = await Promise.all([
      fetchSecurityQuarantinedThreats(WINDOW_DAYS),
      fetchQuarantinedThreats(WINDOW_DAYS),
    ]);
    setMonitorRows(monitor);
    setIntelRows(intel);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const onRestoreMonitor = async (threatKey: string, id: string) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    if (!window.confirm(`Restore ${id}?`)) return;
    setBusyId(`monitor:${threatKey}`);
    const res = await restoreSecurityThreat(threatKey, { removeRule: false });
    if (res.ok) {
      onAction?.(`Restored ${id}`);
      await load();
    } else {
      onAction?.(res.error || 'Restore failed');
    }
    setBusyId('');
  };

  const onRestoreIntel = async (id: string) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    if (!window.confirm(`Restore ${id}?`)) return;
    setBusyId(`intel:${id}`);
    const res = await restoreThreatIntel(id);
    if (res.ok) {
      onAction?.(`Restored ${id}`);
      await load();
    } else {
      onAction?.(res.error || 'Restore failed');
    }
    setBusyId('');
  };

  const totalQuarantined = monitorRows.length + intelRows.length;

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Total Quarantined" value={totalQuarantined} accent="warning" />
        <KpiCard label="Threat Monitor" value={monitorRows.length} accent="danger" />
        <KpiCard label="Threat Intel" value={intelRows.length} accent="info" />
        <KpiCard label="Status" value={totalQuarantined > 0 ? 'Active' : 'Clear'} accent={totalQuarantined > 0 ? 'warning' : 'success'} />
      </div>

      <Card title="Threat Monitor Quarantine" subtitle="Security monitor entries">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : monitorRows.length === 0 ? (
          <EmptyState title="No monitor entries" message="No threat monitor entries are quarantined" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Severity</th>
                  <th>Quarantined</th>
                  <th>Operator</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {monitorRows.map(r => (
                  <tr key={r.threatKey}>
                    <td><code className="text-xs">{r.id}</code></td>
                    <td>{r.type}</td>
                    <td>{r.source}</td>
                    <td><SeverityBadge severity={r.severity} /></td>
                    <td className="text-xs">{formatTs(r.quarantinedAt)}</td>
                    <td>{r.operator || '—'}</td>
                    <td>
                      {canMutate ? (
                        <Button size="sm" variant="ghost" disabled={!!busyId} onClick={() => void onRestoreMonitor(r.threatKey, r.id)}>
                          {busyId === `monitor:${r.threatKey}` ? '…' : 'Restore'}
                        </Button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Threat Intel Quarantine" subtitle="AI threat intel entries">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : intelRows.length === 0 ? (
          <EmptyState title="No intel entries" message="No threat intel entries are quarantined" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Source</th>
                  <th>Severity</th>
                  <th>Description</th>
                  <th>Quarantined</th>
                  <th>Operator</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {intelRows.map(r => (
                  <tr key={r.id}>
                    <td><code className="text-xs">{r.id}</code></td>
                    <td>{r.source}</td>
                    <td><SeverityBadge severity={r.severity} /></td>
                    <td className="text-sm" style={{ maxWidth: 300 }}>
                      <span className="truncate">{r.description?.slice(0, 120)}{r.description && r.description.length > 120 ? '…' : ''}</span>
                    </td>
                    <td className="text-xs">{formatTs(r.quarantinedAt)}</td>
                    <td>{r.operator || '—'}</td>
                    <td>
                      {canMutate ? (
                        <Button size="sm" variant="ghost" disabled={!!busyId} onClick={() => void onRestoreIntel(r.id)}>
                          {busyId === `intel:${r.id}` ? '…' : 'Restore'}
                        </Button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* ── Container ─────────────────────────────────── */

export function SecurityOperationsCenter({ view, onViewChange, roles = [], refreshKey, onAction }: Props) {
  return (
    <section aria-label="Security Operations Center">
      <div className="page-header">
        <div>
          <h1>Security Operations Center</h1>
          <p>Real-time threat monitoring, detection, and response</p>
        </div>
      </div>

      <WorkspaceSubNav tabs={VIEW_TABS} active={view} onChange={onViewChange} />

      {view === 'overview' && <OverviewView roles={roles} refreshKey={refreshKey} onAction={onAction} />}
      {view === 'threats' && <ThreatsView roles={roles} refreshKey={refreshKey} onAction={onAction} />}
      {view === 'intel' && <IntelView roles={roles} refreshKey={refreshKey} onAction={onAction} />}
      {view === 'quarantine' && <QuarantineView roles={roles} refreshKey={refreshKey} onAction={onAction} />}
    </section>
  );
}

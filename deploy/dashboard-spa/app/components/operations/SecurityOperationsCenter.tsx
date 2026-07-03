'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acceptThreatLabCandidate,
  dismissThreatIntel,
  fetchAiThreats,
  fetchHealth,
  fetchIntelQuarantinePolicy,
  fetchMonitorQuarantinePolicy,
  fetchQuarantinedThreats,
  fetchSecurity,
  fetchSecurityDashboard,
  fetchSecurityQuarantinedThreats,
  fetchSwarmStatus,
  type SwarmJobStatus,
  fetchShadowRedTeamReport,
  fetchSignatureHints,
  fetchSupplyChainGraph,
  fetchSwarmLatest,
  fetchThreatLabCandidates,
  pollAiThreats,
  quarantineAllThreats,
  quarantineSecurityThreat,
  quarantineThreatIntel,
  rejectThreatLabCandidate,
  restoreSecurityThreat,
  restoreThreatIntel,
  runSecuritySwarm,
  runThreatLab,
  runAutoThreatResearch,
  type HealthResponse,
  type QuarantinePolicyDetail,
  type QuarantineRecord,
  type SecurityDashboardResponse,
  type SecurityDashboardThreat,
  type SecurityMonitorQuarantineRecord,
  type SecurityResponse,
  type ThreatDiscoveryStatus,
  type ThreatIntelEntry,
  type ThreatIntelStatus,
  type ThreatLabCandidate,
} from '@/lib/mastyf-ai-api';
import { hasPermission } from '@/lib/dashboard-roles';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge, SeverityBadge } from '../ui/Badge';
import { KpiCard } from '../ui/KpiCard';
import { EmptyState } from '../ui/EmptyState';
import { WorkspaceSubNav } from '../ui/WorkspaceSubNav';
import { QuarantinePolicyDrawer } from '../security/QuarantinePolicyDrawer';
import { formatEnforcementStatus, formatQuarantineResultMessage } from '@/lib/quarantine-messages';
import { SocAutomationSection } from './SocAutomationSection';
import { SocAutoResearchSection } from './SocAutoResearchSection';
import { SocEnterpriseIntelSection } from './SocEnterpriseIntelSection';
import { SocSwarmAnalysisView } from './SocSwarmAnalysisView';
import { SocAiLearningView } from './SocAiLearningView';
import { useThreatDiscoveryJobs } from '@/lib/use-threat-discovery-jobs';
import { ThreatDiscoveryJobStatus } from '../ThreatDiscoveryJobStatus';
import { ThreatLabWorkbench } from '../ThreatLabWorkbench';
import { useDashboardWindow } from '../dashboard/DashboardWindowContext';
import type { ThreatLabContext } from '../IncidentInvestigatorDrawer';

type SecurityView = 'overview' | 'threats' | 'intel' | 'swarm' | 'learning' | 'quarantine';
type ThreatDiscoverySubTab = 'overview' | 'threat-lab' | 'auto-research';

type Props = {
  view: SecurityView;
  onViewChange: (v: SecurityView) => void;
  roles?: string[];
  refreshKey: number;
  onAction?: (msg: string) => void;
  threatDiscoveryTick?: number;
  aiRefreshTick?: number;
  threatLabContext?: ThreatLabContext | null;
  threatDiscoverySubTab?: ThreatDiscoverySubTab;
  onClearThreatLabContext?: () => void;
  onOpenThreatLab?: (ctx: ThreatLabContext) => void;
};

const VIEW_TABS = [
  { id: 'overview' as const, label: 'Posture Overview' },
  { id: 'threats' as const, label: 'Threat Detection' },
  { id: 'intel' as const, label: 'Threat Intel' },
  { id: 'swarm' as const, label: 'Swarm Analysis' },
  { id: 'learning' as const, label: 'AI Learning' },
  { id: 'quarantine' as const, label: 'Quarantine' },
];

const THREAT_SUB_TABS: { id: ThreatDiscoverySubTab; label: string }[] = [
  { id: 'overview', label: 'Pipeline' },
  { id: 'threat-lab', label: 'Threat Lab' },
  { id: 'auto-research', label: 'Auto Research' },
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

function pickLatestScanTimestamp(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = 0;
  for (const value of values) {
    if (!value) continue;
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const ms = Date.parse(normalized);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
}

/* ── Overview ──────────────────────────────────── */

function OverviewView({ roles, refreshKey, onAction }: { roles: string[]; refreshKey: number; onAction?: (msg: string) => void }) {
  const { windowParam } = useDashboardWindow();
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [dash, setDash] = useState<SecurityDashboardResponse | null>(null);
  const [sec, setSec] = useState<SecurityResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [swarm, setSwarm] = useState<SwarmJobStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [dashData, secData, healthData, swarmData] = await Promise.all([
      fetchSecurityDashboard(windowParam),
      fetchSecurity(),
      fetchHealth(),
      fetchSwarmStatus(),
    ]);
    setDash(dashData);
    setSec(secData);
    setHealth(healthData);
    setSwarm(swarmData);
    setLoading(false);
  }, [windowParam]);

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
      onAction?.(`Quarantined ${res.quarantined ?? 0} threat(s). See Security → Quarantine for enforcement status and applied YAML rules.`);
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
      onAction?.(formatQuarantineResultMessage(row.id, {
        enforcementStatus: res.enforcementStatus,
        appliedRuleName: res.appliedRuleName,
      }));
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
          value={formatTs(
            pickLatestScanTimestamp(sec?.lastScan, swarm?.finishedAt, dash?.generatedAt) ?? undefined,
          )}
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
              <EmptyState
                title="No active threats"
                message={
                  (dash?.quarantinedCount ?? 0) > 0
                    ? `${dash.quarantinedCount} threat(s) are quarantined and hidden from this list. Open Security → Quarantine and click Restore to show them here again.`
                    : (dash?.executiveSummary?.[0]?.includes('policy blocks')
                      ? 'Blocks are recorded in the window above, but no high-severity threat rows are in the monitor queue.'
                      : 'All clear — no active threats detected in the selected time window.')
                }
              />
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

function ThreatsView({
  roles,
  refreshKey,
  threatDiscoveryTick = 0,
  threatLabContext,
  threatDiscoverySubTab,
  onClearThreatLabContext,
  onAction,
}: {
  roles: string[];
  refreshKey: number;
  threatDiscoveryTick?: number;
  threatLabContext?: ThreatLabContext | null;
  threatDiscoverySubTab?: ThreatDiscoverySubTab;
  onClearThreatLabContext?: () => void;
  onAction?: (msg: string) => void;
}) {
  const [subTab, setSubTab] = useState<ThreatDiscoverySubTab>(threatDiscoverySubTab || 'overview');
  const canMutate = hasPermission(roles, 'policy_mutate');
  const {
    status,
    loading: discoveryLoading,
    threatLabJob,
    autoResearchJob,
    threatLabRunning,
    autoResearchRunning,
    refresh: refreshDiscovery,
    setOptimisticRunning,
  } = useThreatDiscoveryJobs(refreshKey, threatDiscoveryTick);
  const [candidates, setCandidates] = useState<ThreatLabCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (threatDiscoverySubTab) setSubTab(threatDiscoverySubTab);
  }, [threatDiscoverySubTab]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    const labRes = await fetchThreatLabCandidates();
    setCandidates(labRes);
    await refreshDiscovery();
    setLoading(false);
  }, [refreshDiscovery]);

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
    if (threatLabRunning) return;
    setBusy('threat-lab');
    const res = await runThreatLab();
    if (res.ok) {
      setOptimisticRunning('threat-lab', res.jobId);
      onAction?.(`Threat Lab started — job ${res.jobId}`);
      await refreshDiscovery();
    } else {
      onAction?.(res.error || 'Failed to start Threat Lab');
    }
    setBusy('');
  };

  const onAutoResearch = async () => {
    if (autoResearchRunning) return;
    setBusy('auto');
    const res = await runAutoThreatResearch();
    if (res.ok) {
      setOptimisticRunning('auto-research', res.jobId);
      onAction?.(`Auto Research started — job ${res.jobId}`);
      await refreshDiscovery();
    } else {
      onAction?.(res.error || 'Failed to start Auto Research');
    }
    setBusy('');
  };

  const onAccept = async (id: string) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    setBusy(`accept:${id}`);
    const res = await acceptThreatLabCandidate(id);
    if (res.ok) {
      onAction?.(
        res.ruleName
          ? `Accepted ${id} — applied rule ${res.ruleName}`
          : `Accepted ${id}`,
      );
      await load();
    } else {
      onAction?.(res.error || `Failed to accept ${id}`);
    }
    setBusy('');
  };

  const onReject = async (id: string) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    setBusy(`reject:${id}`);
    const res = await rejectThreatLabCandidate(id);
    if (res.ok) {
      onAction?.(`Rejected candidate ${id}`);
      await load();
    } else {
      onAction?.(res.error || `Failed to reject ${id}`);
    }
    setBusy('');
  };

  const pipeline = status?.pipeline;

  const pendingCandidates = candidates.filter(c => c.reviewStatus === 'pending' || !c.reviewStatus);
  const autoEntries = status?.autoCorpus.manifest?.entries ?? [];

  return (
    <>
      <WorkspaceSubNav
        tabs={THREAT_SUB_TABS}
        active={subTab}
        onChange={(id) => setSubTab(id as ThreatDiscoverySubTab)}
      />

      {subTab === 'threat-lab' ? (
        <ThreatLabWorkbench
          candidates={candidates}
          autoEntries={autoEntries}
          roles={roles}
          preloadedContext={threatLabContext}
          manifestMeta={{
            timestamp: status?.threatLab.manifest?.timestamp,
            mode: status?.threatLab.manifest?.mode,
            llmModel: status?.threatLab.manifest?.llmModel,
            llmUsed: status?.threatLab.manifest?.llmUsed,
            skipped: status?.threatLab.manifest?.skipped,
            runNote: status?.threatLab.manifest?.runNote,
          }}
          onRefresh={() => void load()}
          onClearContext={onClearThreatLabContext}
          onRunStarted={onAction}
        />
      ) : null}

      {subTab === 'auto-research' ? (
        <SocAutoResearchSection
          entries={autoEntries}
          status={status}
        />
      ) : null}

      {subTab === 'overview' ? (
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
                    {(!c.reviewStatus || c.reviewStatus === 'pending') && (
                      <div className="flex gap-2 mt-3">
                        {canMutate ? (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              loading={busy === `accept:${c.id}`}
                              disabled={!!busy && busy !== `accept:${c.id}`}
                              onClick={() => void onAccept(c.id)}
                            >
                              {busy === `accept:${c.id}` ? 'Accepting…' : 'Accept'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={busy === `reject:${c.id}`}
                              disabled={!!busy && busy !== `reject:${c.id}`}
                              onClick={() => void onReject(c.id)}
                            >
                              {busy === `reject:${c.id}` ? 'Rejecting…' : 'Reject'}
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted">Requires operator role to accept or reject</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="col-span-4">
          <ThreatDiscoveryJobStatus
            threatLabJob={threatLabJob}
            autoResearchJob={autoResearchJob}
            threatLabDoneDetail={
              status?.threatLab.manifest?.count != null
                ? `${status.threatLab.manifest.count} candidate(s)`
                : undefined
            }
            autoResearchDoneDetail={
              status?.autoCorpus.manifest?.count != null
                ? `${status.autoCorpus.manifest.count} fixture(s)`
                : undefined
            }
          />

          <Card title="Quick Actions" style={{ marginTop: 'var(--space-4)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button variant="primary" onClick={onRunAnalysis} disabled={!!busy}>
                {busy === 'run' ? 'Starting…' : 'Run Analysis'}
              </Button>
              <Button
                variant="secondary"
                onClick={onRunThreatLab}
                disabled={!!busy || threatLabRunning}
              >
                {threatLabRunning || busy === 'threat-lab' ? 'Threat Lab running…' : 'Threat Lab'}
              </Button>
              <Button
                variant="secondary"
                onClick={onAutoResearch}
                disabled={!!busy || autoResearchRunning}
              >
                {autoResearchRunning || busy === 'auto' ? 'Auto Research running…' : 'Auto Research'}
              </Button>
              <Button variant="ghost" onClick={() => void load()} disabled={loading || discoveryLoading}>
                {loading || discoveryLoading ? 'Refreshing…' : 'Refresh'}
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

      <SocAutomationSection refreshKey={refreshKey} onAction={onAction} />
    </>
      ) : null}
    </>
  );
}

/* ── Intel ─────────────────────────────────────── */

function IntelView({ roles, refreshKey, onAction }: { roles: string[]; refreshKey: number; onAction?: (msg: string) => void }) {
  const canMutate = hasPermission(roles, 'policy_mutate');
  const canAi = hasPermission(roles, 'ai');
  const [findings, setFindings] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<ThreatLabCandidate[]>([]);
  const [aiThreats, setAiThreats] = useState<ThreatIntelStatus | null>(null);
  const [supplyChain, setSupplyChain] = useState<Record<string, unknown> | null>(null);
  const [shadowRedTeam, setShadowRedTeam] = useState<Record<string, unknown> | null>(null);
  const [signatureHints, setSignatureHints] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [pollBusy, setPollBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [swarm, lab, threats, sc, shadow, hints] = await Promise.all([
      fetchSwarmLatest(),
      fetchThreatLabCandidates(),
      fetchAiThreats(),
      fetchSupplyChainGraph(),
      fetchShadowRedTeamReport(),
      fetchSignatureHints(),
    ]);
    setFindings(swarm?.findings ?? []);
    setCandidates(lab);
    setAiThreats(threats);
    setSupplyChain(sc);
    setShadowRedTeam(shadow);
    setSignatureHints(hints);
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

  const onPollThreats = async () => {
    if (!canAi) { onAction?.('Requires ai role'); return; }
    setPollBusy(true);
    try {
      const res = await pollAiThreats();
      if (res.ok && res.status) {
        setAiThreats(res.status);
        onAction?.(`Threat catalog refreshed (${res.status.threats} known IDs)`);
      } else {
        onAction?.(res.error || 'Poll failed');
      }
    } finally {
      setPollBusy(false);
    }
  };

  const onQuarantineIntel = async (entry: ThreatIntelEntry) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    if (!window.confirm(`Quarantine ${entry.id}? This may add a blocking policy rule.`)) return;
    setBusy(`q:${entry.id}`);
    const res = await quarantineThreatIntel(entry.id);
    if (res.ok) {
      onAction?.(`Quarantined ${entry.id}${res.appliedRuleName ? ` · rule ${res.appliedRuleName}` : ''}. See Quarantine tab.`);
      await load();
    } else {
      onAction?.(res.error || 'Quarantine failed');
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

  const catalogEntries = aiThreats?.entries ?? [];

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Live Feed Items" value={merged.length} accent="info" />
        <KpiCard label="AI Catalog (CVE/OSV)" value={aiThreats?.threats ?? catalogEntries.length} accent="warning" />
        <KpiCard label="Critical" value={merged.filter(i => i.severity.toUpperCase() === 'CRITICAL').length + catalogEntries.filter(e => e.severity === 'CRITICAL').length} accent="danger" />
        <KpiCard label="Swarm Findings" value={findings.length} accent="info" secondary={aiThreats?.lastPollAt ? `Last poll ${formatTs(aiThreats.lastPollAt)}` : undefined} />
      </div>

      <Card
        title="Live Threat Intelligence Feed"
        subtitle="Merged swarm findings and Threat Lab candidates — sorted by severity"
        actions={
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </Button>
        }
      >
        {loading ? (
          <p className="text-sm text-muted">Loading feed…</p>
        ) : merged.length === 0 ? (
          <EmptyState title="No intel" message="Run Swarm Analysis or Threat Lab to generate findings" />
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
                      {canMutate && item.kind === 'swarm' ? (
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

      <Card
        title="AI Copilot Threat Catalog"
        subtitle="External CVE/OSV/NVD advisories polled by the AI engine — quarantine to auto-apply blocking rules"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void onPollThreats()} disabled={pollBusy || !canAi}>
            {pollBusy ? 'Polling…' : 'Poll sources'}
          </Button>
        }
      >
        {loading ? (
          <p className="text-sm text-muted">Loading catalog…</p>
        ) : catalogEntries.length === 0 ? (
          <EmptyState
            title="No catalog entries"
            message={canAi ? 'Click Poll sources to fetch OSV/NVD/GitHub advisories' : 'Requires ai role to poll external sources'}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Source</th>
                  <th>Severity</th>
                  <th>Package</th>
                  <th>Description</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {catalogEntries.slice(0, 50).map(entry => (
                  <tr key={entry.id} className={entry.severity === 'CRITICAL' ? 'row-critical' : entry.severity === 'HIGH' ? 'row-warning' : ''}>
                    <td><code className="text-xs">{entry.id}</code></td>
                    <td>{entry.source}</td>
                    <td><SeverityBadge severity={entry.severity} /></td>
                    <td className="text-xs">{entry.affectedPackage || '—'}</td>
                    <td className="text-sm">{entry.description?.slice(0, 100)}{entry.description && entry.description.length > 100 ? '…' : ''}</td>
                    <td>
                      {canMutate ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void onQuarantineIntel(entry)}>
                            {busy === `q:${entry.id}` ? '…' : 'Quarantine'}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void onDismiss(entry.id)}>
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SocEnterpriseIntelSection
        supplyChain={supplyChain}
        shadowRedTeam={shadowRedTeam}
        signatureHints={signatureHints}
      />
    </>
  );
}

/* ── Quarantine ──────────────────────────────────── */

function QuarantineView({ roles, refreshKey, onAction }: { roles: string[]; refreshKey: number; onAction?: (msg: string) => void }) {
  const { windowDays } = useDashboardWindow();
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [monitorRows, setMonitorRows] = useState<SecurityMonitorQuarantineRecord[]>([]);
  const [intelRows, setIntelRows] = useState<QuarantineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyDetail, setPolicyDetail] = useState<QuarantinePolicyDetail | null>(null);
  const [policyError, setPolicyError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [monitor, intel] = await Promise.all([
      fetchSecurityQuarantinedThreats(windowDays),
      fetchQuarantinedThreats(windowDays),
    ]);
    setMonitorRows(monitor);
    setIntelRows(intel);
    setLoading(false);
  }, [windowDays]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const openMonitorPolicy = async (row: SecurityMonitorQuarantineRecord) => {
    setPolicyOpen(true);
    setPolicyLoading(true);
    setPolicyError('');
    setPolicyDetail(null);
    const { detail, error } = await fetchMonitorQuarantinePolicy(row);
    setPolicyDetail(detail);
    setPolicyError(error || (!detail ? 'Policy detail unavailable' : ''));
    setPolicyLoading(false);
  };

  const openIntelPolicy = async (row: QuarantineRecord) => {
    setPolicyOpen(true);
    setPolicyLoading(true);
    setPolicyError('');
    setPolicyDetail(null);
    const { detail, error } = await fetchIntelQuarantinePolicy(row);
    setPolicyDetail(detail);
    setPolicyError(error || (!detail ? 'Policy detail unavailable' : ''));
    setPolicyLoading(false);
  };

  const onRestoreMonitor = async (threatKey: string, id: string) => {
    if (!canMutate) { onAction?.('Requires operator role'); return; }
    if (!window.confirm(`Restore ${id}?`)) return;
    const removeRule = window.confirm(
      `Remove the quarantine policy rule from your YAML policy file?\n\nOK — restore and delete the quarantine-* rule\nCancel — restore only (keep the rule)`,
    );
    setBusyId(`monitor:${threatKey}`);
    const res = await restoreSecurityThreat(threatKey, { removeRule });
    if (res.ok) {
      onAction?.(
        removeRule
          ? `Restored ${id}. Policy rule ${res.removedRule ? 'removed' : 'not found in policy'}`
          : `Restored ${id} (policy rule kept)`,
      );
      setPolicyOpen(false);
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
      setPolicyOpen(false);
      await load();
    } else {
      onAction?.(res.error || 'Restore failed');
    }
    setBusyId('');
  };

  const totalQuarantined = monitorRows.length + intelRows.length;

  return (
    <>
      <QuarantinePolicyDrawer
        open={policyOpen}
        loading={policyLoading}
        detail={policyDetail}
        error={policyError}
        onClose={() => {
          setPolicyOpen(false);
          setPolicyDetail(null);
          setPolicyError('');
        }}
      />

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
                  <th>Enforcement</th>
                  <th>Applied rule</th>
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
                    <td className="text-xs">{formatEnforcementStatus(r.enforcementStatus)}</td>
                    <td className="text-xs">{r.appliedRuleName ? <code>{r.appliedRuleName}</code> : '—'}</td>
                    <td className="text-xs">{formatTs(r.quarantinedAt)}</td>
                    <td>{r.operator || '—'}</td>
                    <td>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => void openMonitorPolicy(r)}>
                          Policy
                        </Button>
                        {canMutate ? (
                          <Button size="sm" variant="ghost" disabled={!!busyId} onClick={() => void onRestoreMonitor(r.threatKey, r.id)}>
                            {busyId === `monitor:${r.threatKey}` ? '…' : 'Restore'}
                          </Button>
                        ) : null}
                      </div>
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
                  <th>Applied rule</th>
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
                    <td className="text-xs">{r.appliedRuleName ? <code>{r.appliedRuleName}</code> : '—'}</td>
                    <td className="text-xs">{formatTs(r.quarantinedAt)}</td>
                    <td>{r.operator || '—'}</td>
                    <td>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => void openIntelPolicy(r)}>
                          Policy
                        </Button>
                        {canMutate ? (
                          <Button size="sm" variant="ghost" disabled={!!busyId} onClick={() => void onRestoreIntel(r.id)}>
                            {busyId === `intel:${r.id}` ? '…' : 'Restore'}
                          </Button>
                        ) : null}
                      </div>
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

export function SecurityOperationsCenter({
  view,
  onViewChange,
  roles = [],
  refreshKey,
  onAction,
  threatDiscoveryTick = 0,
  aiRefreshTick = 0,
  threatLabContext,
  threatDiscoverySubTab,
  onClearThreatLabContext,
  onOpenThreatLab,
}: Props) {
  return (
    <section aria-label="Security Operations Center">
      <div className="page-header">
        <div>
          <h1>Security Operations Center</h1>
          <p>mastyf.ai — detect, analyze, quarantine, and learn from threats across your MCP fleet</p>
        </div>
      </div>

      <WorkspaceSubNav tabs={VIEW_TABS} active={view} onChange={onViewChange} />

      {view === 'overview' && <OverviewView roles={roles} refreshKey={refreshKey} onAction={onAction} />}
      {view === 'threats' && (
        <ThreatsView
          roles={roles}
          refreshKey={refreshKey}
          threatDiscoveryTick={threatDiscoveryTick}
          threatLabContext={threatLabContext}
          threatDiscoverySubTab={threatDiscoverySubTab}
          onClearThreatLabContext={onClearThreatLabContext}
          onAction={onAction}
        />
      )}
      {view === 'intel' && <IntelView roles={roles} refreshKey={refreshKey} onAction={onAction} />}
      {view === 'swarm' && (
        <SocSwarmAnalysisView roles={roles} refreshKey={refreshKey} onAction={onAction} />
      )}
      {view === 'learning' && (
        <SocAiLearningView
          roles={roles}
          refreshKey={refreshKey}
          aiRefreshTick={aiRefreshTick}
          onAction={onAction}
          onOpenThreatLab={onOpenThreatLab}
        />
      )}
      {view === 'quarantine' && <QuarantineView roles={roles} refreshKey={refreshKey} onAction={onAction} />}
    </section>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAggregateMetrics,
  fetchAudit,
  fetchAuthStatus,
  guardianFetch,
  fetchCost,
  fetchHealth,
  fetchFleetInstances,
  fetchSecurity,
  rejectFp,
  downloadMcpHealthReport,
  type FleetResponse,
  type AuditResponse,
  type AggregateMetrics,
  type CostResponse,
  type HealthResponse,
  type SecurityResponse,
} from '@/lib/guardian-api';
import { useDashboardWs } from '@/lib/use-dashboard-ws';
import {
  DEFAULT_WORKSPACE,
  WORKSPACES,
  parseNavFromUrl,
  syncNavToUrl,
  type WorkspaceId,
  type SecurityView,
  type ThreatsView,
  type OperationsView,
  type SettingsView,
  type ActivityView,
} from '@/lib/workspace-nav';
import { DashboardShell } from './DashboardShell';
import { LoginGate } from './LoginGate';
import { EnterpriseLayout } from './layout/EnterpriseLayout';
import { WorkspaceSubNav } from './ui/WorkspaceSubNav';
import { AgentFlowPanel } from './AgentFlowPanel';
import { SetupChecklistPanel } from './setup/SetupChecklistPanel';
import { AnalyticsDashboardPanel } from './analytics/AnalyticsDashboardPanel';
import { SecurityDashboardPanel } from './security/SecurityDashboardPanel';
import { QuarantinedIntelPanel } from './security/QuarantinedIntelPanel';
import { SwarmPanel } from './SwarmPanel';
import { AiLearningPanel } from './AiLearningPanel';
import { ThreatDiscoveryPanel } from './ThreatDiscoveryPanel';
import { EnterpriseAiPanel } from './EnterpriseAiPanel';
import { PolicyPanel } from './PolicyPanel';
import { AdminPanel } from './AdminPanel';
import { TenantContextBar } from './TenantContextBar';
import { ProUpgradeBanner } from './ProUpgradeBanner';
import { CostGovernancePanel } from './dashboard/CostGovernancePanel';
import { SecurityPosturePanel } from './dashboard/SecurityPosturePanel';
import { HealthReliabilityPanel } from './dashboard/HealthReliabilityPanel';
import { AuditExplorerPanel } from './dashboard/AuditExplorerPanel';
import { FleetOverviewPanel } from './dashboard/FleetOverviewPanel';
import { AnalyticsChartsHub } from './dashboard/AnalyticsChartsHub';
import {
  DashboardWindowProvider,
  DashboardWindowSelector,
  useCurrentWindowDays,
} from './dashboard/DashboardWindowContext';
import { DashboardRegionProvider, DashboardRegionSelector } from './dashboard/DashboardRegionContext';
import { VisualsProvider } from './dashboard/VisualsProvider';
import { hasPermission } from '@/lib/dashboard-roles';
import type { AuthStatus } from '@/lib/guardian-api';
import type { ThreatLabContext } from './IncidentInvestigatorDrawer';
import { ProtectionWorkspace } from './workspaces/ProtectionWorkspace';
import { HelpWorkspace } from './workspaces/HelpWorkspace';
import { LiveThreatIntelPanel } from './live/LiveThreatIntelPanel';
import { LiveBenchmarksPanel } from './live/LiveBenchmarksPanel';
import { LiveMcpServersPanel } from './live/LiveMcpServersPanel';
import type { SwarmJobStatus } from '@/lib/guardian-api';

const POLL_FAILURES_BEFORE_DOWN = 3;
const STATUS_DEBOUNCE_MS = 400;
const REST_POLL_MS = 30_000;

const DEFAULT_VIEWS: Record<WorkspaceId, string | undefined> = {
  home: undefined,
  activity: 'analysis',
  threats: 'overview',
  security: 'overview',
  operations: 'overview',
  settings: 'setup',
  help: undefined,
};

export function DashboardClient() {
  const [ready, setReady] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceId>(DEFAULT_WORKSPACE);
  const [securityView, setSecurityView] = useState<SecurityView>('overview');
  const [operationsView, setOperationsView] = useState<OperationsView>('overview');
  const [settingsView, setSettingsView] = useState<SettingsView>('setup');
  const [activityView, setActivityView] = useState<ActivityView>('analysis');
  const [threatsView, setThreatsView] = useState<ThreatsView>('overview');
  const [helpTopic, setHelpTopic] = useState<string | undefined>();
  const [swarmJobStatus, setSwarmJobStatus] = useState<SwarmJobStatus | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [statusIsError, setStatusIsError] = useState(false);
  const [apiUnreachable, setApiUnreachable] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [metrics, setMetrics] = useState<AggregateMetrics | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);
  const [security, setSecurity] = useState<SecurityResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [fleetMeta, setFleetMeta] = useState<FleetResponse | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [sessionKey, setSessionKey] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [auditAction, setAuditAction] = useState('');
  const [auditServer, setAuditServer] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [threatLabContext, setThreatLabContext] = useState<ThreatLabContext | null>(null);
  const [threatDiscoverySubTab, setThreatDiscoverySubTab] = useState<
    'overview' | 'threat-lab' | 'auto-research' | 'architecture' | undefined
  >();
  const [policyCopilotTab, setPolicyCopilotTab] = useState<'generate' | 'counterfactual'>('generate');

  const pollFailuresRef = useRef(0);
  const statusTimerRef = useRef<number | null>(null);
  const chartRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ws = useDashboardWs(ready, sessionKey);
  const { windowDays: currentWindowDays, windowLabel: currentWindowLabel } = useCurrentWindowDays();
  const visualsPollMs = currentWindowLabel === '1h' ? 10_000 : REST_POLL_MS;

  const scheduleChartRefresh = useCallback(() => {
    if (chartRefreshDebounceRef.current) {
      globalThis.clearTimeout(chartRefreshDebounceRef.current);
    }
    chartRefreshDebounceRef.current = globalThis.setTimeout(() => {
      setRefreshTick((t) => t + 1);
    }, 750);
  }, []);

  const applyView = useCallback((wsId: WorkspaceId, view?: string, topic?: string) => {
    if (wsId === 'security' && view) setSecurityView(view as SecurityView);
    if (wsId === 'threats' && view) setThreatsView(view as ThreatsView);
    if (wsId === 'operations' && view) setOperationsView(view as OperationsView);
    if (wsId === 'settings' && view) setSettingsView(view as SettingsView);
    if (wsId === 'activity' && view) {
      const v = view === 'flow' ? 'analysis' : view;
      setActivityView(v as ActivityView);
    }
    if (wsId === 'help' && topic) setHelpTopic(topic);
  }, []);

  const navigate = useCallback(
    (wsId: WorkspaceId, view?: string, topic?: string) => {
      setWorkspace(wsId);
      const v = view ?? DEFAULT_VIEWS[wsId];
      applyView(wsId, v, topic);
      syncNavToUrl({ workspace: wsId, view: v, topic });
    },
    [applyView],
  );

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
      const authProbe = await guardianFetch('/api/auth/status');
      const apiUp = authProbe.ok;

      const loadCost = workspace === 'operations' && operationsView === 'cost';
      const [auditRes, metricsRes, costRes, secRes, healthRes, fleetRes, authRes] =
        await Promise.all([
          fetchAudit({
            windowDays: currentWindowDays,
            limit: 100,
            action: auditAction || undefined,
            server: auditServer || undefined,
          }),
          fetchAggregateMetrics(currentWindowDays),
          loadCost ? fetchCost(currentWindowDays) : Promise.resolve(null),
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
        if (apiUp) {
          pollFailuresRef.current = 0;
          setApiUnreachable(false);
          applyStatus(
            'Dashboard API connected — no proxy history DB yet',
            false,
          );
        } else {
          pollFailuresRef.current += 1;
          if (pollFailuresRef.current >= POLL_FAILURES_BEFORE_DOWN) {
            setApiUnreachable(true);
            if (!ws.connected) {
              applyStatus('API unavailable — check proxy on :4000', true);
            }
          }
        }
        if (secRes) setSecurity(secRes);
        if (healthRes) setHealth(healthRes);
        setFleetMeta(fleetRes);
        return;
      }

      pollFailuresRef.current = 0;
      setApiUnreachable(false);
      if (!ws.connected) {
        applyStatus('Connected — live data from proxy', false);
      } else {
        applyStatus(ws.statusText, ws.statusIsError);
      }
      if (auditRes) setAudit(auditRes);
      if (metricsRes) setMetrics(metricsRes);
      if (costRes) setCost(costRes);
      if (secRes) setSecurity(secRes);
      if (healthRes) setHealth(healthRes);
      setFleetMeta(fleetRes);
      setRefreshTick((t) => t + 1);
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
  }, [
    applyStatus,
    auditAction,
    auditServer,
    currentWindowDays,
    workspace,
    operationsView,
    ws.connected,
    ws.statusText,
    ws.statusIsError,
  ]);

  useEffect(() => {
    setReady(true);
    const parsed = parseNavFromUrl(window.location.search);
    setWorkspace(parsed.workspace);
    if (parsed.view || parsed.topic) applyView(parsed.workspace, parsed.view, parsed.topic);
  }, [applyView]);

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
    if (!ws.metricsPatch) return;
    scheduleChartRefresh();
  }, [ws.metricsPatch, scheduleChartRefresh]);

  useEffect(() => {
    if (!ws.auditPatch) return;
    scheduleChartRefresh();
  }, [ws.auditPatch, scheduleChartRefresh]);

  useEffect(() => {
    return () => {
      if (chartRefreshDebounceRef.current) {
        globalThis.clearTimeout(chartRefreshDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!ws.auditPatch) return;
    const patch = ws.auditPatch;
    setAudit((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        ...patch,
        events: patch.events ?? prev.events,
        total: patch.total ?? prev.total,
        blocked: patch.blocked ?? prev.blocked,
        passed: patch.passed ?? prev.passed,
        flagged: patch.flagged ?? prev.flagged,
        semanticAudit: patch.semanticAudit ?? prev.semanticAudit,
      };
    });
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
  const lastBlocked = (displayAudit?.events || []).find((e) => e.action === 'block');

  const liveTotal = displayMetrics?.totalRequests ?? displayAudit?.total ?? null;
  const liveBlocked = displayMetrics?.blockedRequests ?? displayAudit?.blocked ?? null;
  const proxyOnline: boolean | null = apiUnreachable ? false : metrics || audit || ws.connected ? true : null;
  const connection: 'live' | 'degraded' | 'offline' | 'connecting' =
    proxyOnline === true ? (ws.connected ? 'live' : 'degraded') : proxyOnline === false ? 'offline' : 'connecting';

  const topbarExtra = (
    <>
      <p className={statusIsError ? 'status status-error' : 'status'} suppressHydrationWarning>
        {status}
      </p>
      <TenantContextBar authStatus={authStatus} />
      <ProUpgradeBanner authStatus={authStatus} />
      <DashboardWindowSelector />
      <DashboardRegionSelector />
    </>
  );

  const openThreatLab = (ctx: ThreatLabContext) => {
    setThreatLabContext(ctx);
    setThreatDiscoverySubTab('threat-lab');
    navigate('threats', 'threat-lab');
    setActionMsg('Opened incident in Threat Lab');
  };

  const openThreats = (view: string) => {
    navigate('threats', view);
  };

  return (
    <LoginGate onAuthenticated={onAuthenticated}>
      <DashboardWindowProvider>
        <DashboardRegionProvider>
          <VisualsProvider refreshKey={refreshTick} pollMs={visualsPollMs}>
            <EnterpriseLayout
              workspaces={WORKSPACES}
              activeWorkspace={workspace}
              onNavigate={(id) => navigate(id)}
              topbarExtra={topbarExtra}
              connection={connection}
              wsConnected={ws.connected}
              wsEventCount={ws.entries.length}
              liveBlocked={connection === 'live' ? liveBlocked : null}
              liveTotal={connection === 'live' ? liveTotal : null}
              onRefresh={() => void refreshAll()}
              onDownloadReport={
                workspace === 'home'
                  ? () => void downloadMcpHealthReport(currentWindowDays, false)
                  : undefined
              }
              reportLoading={reportLoading}
            >
              {apiUnreachable && <OfflineNotice />}
              {actionMsg ? <p className="action-msg">{actionMsg}</p> : null}

              {workspace === 'home' && (
                <ProtectionWorkspace
                  refreshKey={refreshTick}
                  metrics={displayMetrics}
                  audit={displayAudit}
                  proxyOnline={proxyOnline}
                  onReportLoading={setReportLoading}
                  onAction={(m) => setActionMsg(m)}
                  onNavigateAdvanced={(ws, view) => navigate(ws as WorkspaceId, view)}
                />
              )}

              {workspace === 'activity' && (
                <>
                  <WorkspaceSubNav
                    tabs={[
                      { id: 'analysis', label: 'Security analysis' },
                      { id: 'audit', label: 'Live audit' },
                    ]}
                    active={activityView}
                    onChange={(v) => {
                      setActivityView(v as ActivityView);
                      syncNavToUrl({ workspace: 'activity', view: v });
                    }}
                  />
                  {activityView === 'analysis' && (
                    <AgentFlowPanel
                      ws={ws}
                      roles={roles}
                      swarmJobStatus={swarmJobStatus}
                      onSwarmStatus={setSwarmJobStatus}
                      onOpenThreats={openThreats}
                    />
                  )}
                  {activityView === 'audit' && (
                    <AuditExplorerPanel
                      audit={displayAudit}
                      refreshKey={refreshTick}
                      auditAction={auditAction}
                      auditServer={auditServer}
                      onFilterChange={(action, server) => {
                        setAuditAction(action);
                        setAuditServer(server);
                      }}
                      onApplyFilters={() => void refreshAll()}
                      onFpReject={(rule, pattern) => void onFpReject(rule, pattern)}
                      canMutate={hasPermission(roles, 'policy_mutate')}
                    />
                  )}
                </>
              )}

              {workspace === 'threats' && (
                <>
                  <WorkspaceSubNav
                    tabs={[
                      { id: 'overview', label: 'Overview' },
                      { id: 'threat-lab', label: 'Threat Lab' },
                      { id: 'auto-research', label: 'Auto Research' },
                      { id: 'automation', label: 'Automation' },
                      { id: 'architecture', label: 'Architecture' },
                      { id: 'intel', label: 'Intel catalog' },
                    ]}
                    active={threatsView}
                    onChange={(v) => {
                      setThreatsView(v as ThreatsView);
                      syncNavToUrl({ workspace: 'threats', view: v });
                    }}
                  />
                  {threatsView === 'intel' ? (
                    <LiveThreatIntelPanel />
                  ) : (
                    <ThreatDiscoveryPanel
                      roles={roles}
                      authStatus={authStatus}
                      refreshKey={ws.threatDiscoveryTick}
                      onAction={(m) => setActionMsg(m)}
                      externalView={
                        threatsView as 'overview' | 'threat-lab' | 'auto-research' | 'automation' | 'architecture'
                      }
                      initialSubTab={threatDiscoverySubTab}
                      threatLabContext={threatLabContext}
                      onClearThreatLabContext={() => setThreatLabContext(null)}
                    />
                  )}
                </>
              )}

              {workspace === 'security' && (
                <>
                  <WorkspaceSubNav
                    tabs={[
                      { id: 'overview', label: 'Dashboard' },
                      { id: 'policy', label: 'Policy' },
                      { id: 'enterprise-ai', label: 'Enterprise AI' },
                      { id: 'ai-copilot', label: 'AI copilot' },
                      { id: 'quarantined-intel', label: 'Quarantined' },
                    ]}
                    active={securityView}
                    onChange={(v) => {
                      setSecurityView(v);
                      syncNavToUrl({ workspace: 'security', view: v });
                    }}
                  />
                  {securityView === 'overview' && (
                    <>
                      <SecurityDashboardPanel
                        refreshKey={refreshTick}
                        roles={roles}
                        onNavigate={navigate}
                        onAction={(m) => setActionMsg(m)}
                      />
                      <details className="security-manifest-detail">
                        <summary>Manifest scan detail</summary>
                        <SecurityPosturePanel
                          security={security}
                          refreshKey={refreshTick}
                          onOpenThreatDiscovery={() => navigate('threats', 'overview')}
                        />
                      </details>
                    </>
                  )}
                  {securityView === 'policy' && (
                    <PolicyPanel
                      roles={roles}
                      lastBlocked={lastBlocked ?? null}
                      onAction={(m) => setActionMsg(m)}
                      copilotInitialTab={policyCopilotTab}
                    />
                  )}
                  {securityView === 'enterprise-ai' && (
                    <EnterpriseAiPanel
                      roles={roles}
                      refreshTick={ws.aiRefreshTick}
                      onAction={(m) => setActionMsg(m)}
                      onOpenThreatLab={openThreatLab}
                      onOpenPolicyCounterfactual={() => {
                        setPolicyCopilotTab('counterfactual');
                        navigate('security', 'policy');
                        setActionMsg('Open Policy counterfactual');
                      }}
                    />
                  )}
                  {securityView === 'ai-copilot' && (
                    <AiLearningPanel
                      roles={roles}
                      refreshTick={ws.aiRefreshTick}
                      onAction={(m) => setActionMsg(m)}
                      onOpenThreatLab={openThreatLab}
                    />
                  )}
                  {securityView === 'quarantined-intel' && (
                    <QuarantinedIntelPanel
                      roles={roles}
                      onAction={(m) => setActionMsg(m)}
                    />
                  )}
                </>
              )}

              {workspace === 'operations' && (
                <>
                  <WorkspaceSubNav
                    tabs={[
                      { id: 'analytics', label: 'Analytics' },
                      { id: 'overview', label: 'Overview' },
                      { id: 'cost', label: 'Cost' },
                      { id: 'health', label: 'Health' },
                      { id: 'fleet', label: 'Fleet' },
                      { id: 'benchmarks', label: 'Benchmarks' },
                      { id: 'swarm', label: 'Swarm' },
                    ]}
                    active={operationsView}
                    onChange={(v) => {
                      setOperationsView(v);
                      syncNavToUrl({ workspace: 'operations', view: v });
                    }}
                  />
                  {operationsView === 'analytics' && (
                    <AnalyticsDashboardPanel refreshKey={refreshTick} wsConnected={ws.connected} />
                  )}
                  {operationsView === 'overview' && (
                    <AnalyticsChartsHub refreshKey={refreshTick} />
                  )}
                  {operationsView === 'cost' && (
                    <CostGovernancePanel refreshKey={refreshTick} initialCost={cost} />
                  )}
                  {operationsView === 'health' && (
                    <HealthReliabilityPanel health={health} refreshKey={refreshTick} />
                  )}
                  {operationsView === 'fleet' && (
                    <FleetOverviewPanel fleet={fleetMeta?.instances ?? []} meta={fleetMeta} />
                  )}
                  {operationsView === 'benchmarks' && <LiveBenchmarksPanel />}
                  {operationsView === 'swarm' && (
                    <SwarmPanel
                      pipeline={ws.pipeline}
                      swarmDoneTick={ws.swarmDoneTick}
                      swarmJobStatus={swarmJobStatus}
                      onSwarmStatus={setSwarmJobStatus}
                      onOpenThreats={openThreats}
                      onGoAnalysis={() => navigate('activity', 'analysis')}
                    />
                  )}
                </>
              )}

              {workspace === 'settings' && (
                <>
                  <WorkspaceSubNav
                    tabs={[
                      { id: 'setup', label: 'Setup' },
                      { id: 'mcp-servers', label: 'MCP servers' },
                      { id: 'admin', label: 'Admin' },
                    ]}
                    active={settingsView}
                    onChange={(v) => {
                      setSettingsView(v);
                      syncNavToUrl({ workspace: 'settings', view: v });
                    }}
                  />
                  {settingsView === 'setup' && (
                    <SetupChecklistPanel
                      onGoToAgentFlow={() => navigate('activity', 'analysis')}
                      onAction={(m) => setActionMsg(m)}
                    />
                  )}
                  {settingsView === 'mcp-servers' && <LiveMcpServersPanel />}
                  {settingsView === 'admin' && (
                    <AdminPanel roles={roles} tenantLocked={!!authStatus?.tenantLocked} />
                  )}
                </>
              )}

              {workspace === 'help' && <HelpWorkspace initialTopic={helpTopic} />}
            </EnterpriseLayout>
          </VisualsProvider>
        </DashboardRegionProvider>
      </DashboardWindowProvider>
    </LoginGate>
  );
}

function OfflineNotice() {
  return (
    <div className="banner" role="status">
      Guardian API not reachable. Run the proxy with <code>DASHBOARD_ENABLED=true</code> on port
      4000, restart after <code>pnpm dashboard:build</code>, or set{' '}
      <code>?apiBase=http://localhost:4000</code>.
    </div>
  );
}

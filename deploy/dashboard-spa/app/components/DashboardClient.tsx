'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAggregateMetrics,
  fetchAudit,
  fetchAuthStatus,
  mastyfAiFetch,
  rejectFp,
  fetchCost,
  fetchHealth,
  fetchFleetInstances,
  fetchSecurity,
  type FleetResponse,
  type AuditResponse,
  type AggregateMetrics,
  type CostResponse,
  type HealthResponse,
  type SecurityResponse,
  type SwarmJobStatus,
} from '@/lib/mastyf-ai-api';
import { useDashboardWs } from '@/lib/use-dashboard-ws';
import {
  DEFAULT_WORKSPACE,
  parseNavFromUrl,
  syncNavToUrl,
  type WorkspaceId,
  type SecurityView,
  type CostView,
  type ServersView,
  type PolicyView,
  type ActivityView,
  type ComplianceView,
  type SettingsView,
  type LogsView as LogsViewType,
  LEGACY_WORKSPACE_MAP,
} from '@/lib/workspace-nav';
import { DashboardShell } from './DashboardShell';
import { LoginGate } from './LoginGate';
import { EnterpriseLayout } from './layout/EnterpriseLayout';
import { useToast } from './ui/Toast';
import { hasPermission } from '@/lib/dashboard-roles';
import type { AuthStatus } from '@/lib/mastyf-ai-api';
import type { ThreatLabContext } from './IncidentInvestigatorDrawer';

import { ExecutiveDashboard } from './dashboard/ExecutiveDashboard';
import { ActivityCenter } from './operations/ActivityCenter';
import { SecurityOperationsCenter } from './operations/SecurityOperationsCenter';
import { PolicyControlCenter } from './operations/PolicyControlCenter';
import { CostIntelligenceCenter } from './operations/CostIntelligenceCenter';
import { ServersFleetCenter } from './operations/ServersFleetCenter';
import { ConfigurationHub } from './operations/ConfigurationHub';
import { OperatorEnablementCenter } from './operations/OperatorEnablementCenter';
import { ComplianceCenter } from './operations/ComplianceCenter';
import { LogsViewer } from './operations/LogsViewer';

import {
  DashboardWindowProvider,
  DashboardWindowSelector,
  useCurrentWindowDays,
} from './dashboard/DashboardWindowContext';
import { DashboardRegionProvider, DashboardRegionSelector } from './dashboard/DashboardRegionContext';
import { VisualsProvider } from './dashboard/VisualsProvider';

const POLL_FAILURES_BEFORE_DOWN = 3;
const STATUS_DEBOUNCE_MS = 400;
const REST_POLL_MS = 30_000;

export function DashboardClient() {
  const [ready, setReady] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceId>(DEFAULT_WORKSPACE);
  const [activeView, setActiveView] = useState<string | undefined>();

  const [securityView, setSecurityView] = useState<SecurityView>('overview');
  const [activityView, setActivityView] = useState<ActivityView>('realtime');
  const [policyView, setPolicyView] = useState<PolicyView>('rules');
  const [costView, setCostView] = useState<CostView>('overview');
  const [serversView, setServersView] = useState<ServersView>('overview');
  const [complianceView, setComplianceView] = useState<ComplianceView>('overview');
  const [settingsView, setSettingsView] = useState<SettingsView>('general');
  const [logsView, setLogsView] = useState<LogsViewType>('events');

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
  const [statusMsg, setStatusMsg] = useState('');
  const [sessionKey, setSessionKey] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [swarmJobStatus, setSwarmJobStatus] = useState<SwarmJobStatus | null>(null);
  const [auditAction, setAuditAction] = useState('');
  const [auditServer, setAuditServer] = useState('');
  const [threatLabContext, setThreatLabContext] = useState<ThreatLabContext | null>(null);
  const [threatDiscoverySubTab, setThreatDiscoverySubTab] = useState<'overview' | 'threat-lab' | 'auto-research' | undefined>();
  const [policyCopilotTab, setPolicyCopilotTab] = useState<'generate' | 'counterfactual'>('generate');
  const [helpTopic, setHelpTopic] = useState<string | undefined>();

  const pollFailuresRef = useRef(0);
  const statusTimerRef = useRef<number | null>(null);

  const ws = useDashboardWs(ready, sessionKey);
  const { toast } = useToast();
  const { windowParam, windowLabel } = useCurrentWindowDays();
  const visualsPollMs = windowLabel === '1h' ? 10_000 : REST_POLL_MS;

  const onAction = useCallback((msg: string) => {
    toast(msg, msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error') ? 'error' : 'success');
  }, [toast]);

  const applyStatus = useCallback((text: string, isError: boolean, immediate = false) => {
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    const apply = () => { setStatus(text); setStatusIsError(isError); };
    if (immediate) { apply(); return; }
    statusTimerRef.current = window.setTimeout(apply, STATUS_DEBOUNCE_MS);
  }, []);

  const navigate = useCallback((wsId: WorkspaceId, view?: string, topic?: string) => {
    const mapped = LEGACY_WORKSPACE_MAP[wsId] ?? wsId;
    setWorkspace(mapped);
    setActiveView(view);
    if (mapped === 'activity' && view) setActivityView(view as ActivityView);
    if (mapped === 'security' && view) setSecurityView(view as SecurityView);
    if (mapped === 'policy' && view) setPolicyView(view as PolicyView);
    if (mapped === 'cost' && view) setCostView(view as CostView);
    if (mapped === 'servers' && view) setServersView(view as ServersView);
    if (mapped === 'compliance' && view) setComplianceView(view as ComplianceView);
    if (mapped === 'settings' && view) setSettingsView(view as SettingsView);
    if (mapped === 'logs' && view) setLogsView(view as LogsViewType);
    if (mapped === 'help' && topic) setHelpTopic(topic);
    syncNavToUrl({ workspace: mapped, view, topic });
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [auditRes, metricsRes, costRes, secRes, healthRes, fleetRes, authRes] =
        await Promise.all([
          fetchAudit({ windowParam, limit: 100, action: auditAction || undefined, server: auditServer || undefined }),
          fetchAggregateMetrics(windowParam),
          fetchCost(windowParam),
          fetchSecurity(),
          fetchHealth(),
          fetchFleetInstances(),
          fetchAuthStatus(),
        ]);
      if (authRes) { setAuthStatus(authRes); if (authRes.roles) setRoles(authRes.roles); }
      if (auditRes) setAudit(auditRes);
      if (metricsRes) setMetrics(metricsRes);
      if (costRes) setCost(costRes);
      if (secRes) setSecurity(secRes);
      if (healthRes) setHealth(healthRes);
      setFleetMeta(fleetRes);

      if (!auditRes && !metricsRes && !costRes) {
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= POLL_FAILURES_BEFORE_DOWN) { setApiUnreachable(true); applyStatus('API unavailable — check proxy on :4000', true); }
      } else {
        pollFailuresRef.current = 0;
        setApiUnreachable(false);
        applyStatus('Connected — live data from proxy', false);
        setRefreshTick(t => t + 1);
      }
    } catch { pollFailuresRef.current += 1; if (pollFailuresRef.current >= POLL_FAILURES_BEFORE_DOWN) setApiUnreachable(true); }
  }, [applyStatus, windowParam, auditAction, auditServer]);

  useEffect(() => {
    setReady(true);
    const parsed = parseNavFromUrl(window.location.search);
    setWorkspace(parsed.workspace);
    setActiveView(parsed.view);
    if (parsed.view && parsed.workspace === 'activity') setActivityView(parsed.view as ActivityView);
    if (parsed.view && parsed.workspace === 'security') setSecurityView(parsed.view as SecurityView);
    if (parsed.view && parsed.workspace === 'policy') setPolicyView(parsed.view as PolicyView);
    if (parsed.view && parsed.workspace === 'cost') setCostView(parsed.view as CostView);
    if (parsed.view && parsed.workspace === 'servers') setServersView(parsed.view as ServersView);
    if (parsed.view && parsed.workspace === 'compliance') setComplianceView(parsed.view as ComplianceView);
    if (parsed.view && parsed.workspace === 'settings') setSettingsView(parsed.view as SettingsView);
    if (parsed.view && parsed.workspace === 'logs') setLogsView(parsed.view as LogsViewType);
    if (new URLSearchParams(window.location.search).get('workspace') === 'agentic') {
      syncNavToUrl({ workspace: parsed.workspace, view: parsed.view, topic: parsed.topic });
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refreshAll();
    const interval = window.setInterval(() => void refreshAll(), REST_POLL_MS);
    return () => window.clearInterval(interval);
  }, [ready, sessionKey, refreshAll]);

  if (!ready) return <DashboardShell />;

  const displayMetrics = metrics ?? ws.metricsPatch;
  const displayAudit = audit;
  const lastBlocked = (displayAudit?.events || []).find(e => e.action === 'block');
  const proxyOnline: boolean | null = apiUnreachable ? false : metrics || audit || ws.connected ? true : null;
  const connection: 'live' | 'degraded' | 'offline' | 'connecting' =
    proxyOnline === true ? (ws.connected ? 'live' : 'degraded') : proxyOnline === false ? 'offline' : 'connecting';

  const topbarExtra = (
    <>
      <DashboardWindowSelector />
      <DashboardRegionSelector />
    </>
  );

  const statusBar = (
    <span className={statusIsError ? 'text-danger' : ''}>
      {status}
      {statusMsg && <span className="text-info" style={{ marginLeft: 12 }}>{statusMsg}</span>}
    </span>
  );

  const openThreatLab = (ctx: ThreatLabContext) => {
    setThreatLabContext(ctx);
    setThreatDiscoverySubTab('threat-lab');
    navigate('security', 'threats');
  };

  const openThreats = (view: string) => {
    navigate('security', view as SecurityView);
  };

  const onFpReject = async (rule: string, pattern: string) => {
    if (!hasPermission(roles, 'policy_mutate')) { setStatusMsg('Requires operator role'); return; }
    const res = await rejectFp({ rule, pattern: pattern || rule });
    setStatusMsg(res.ok ? 'FP rejection recorded' : res.error || 'FP reject failed');
    if (res.ok) await refreshAll();
  };

  return (
    <LoginGate onAuthenticated={() => setSessionKey(k => k + 1)}>
      <DashboardWindowProvider>
        <DashboardRegionProvider>
          <VisualsProvider refreshKey={refreshTick} pollMs={visualsPollMs}>
            <EnterpriseLayout
              activeWorkspace={workspace}
              activeView={activeView}
              onNavigate={navigate}
              topbarExtra={topbarExtra}
              statusBar={statusBar}
              connection={connection}
              wsConnected={ws.connected}
              wsEventCount={ws.entries.length}
              onRefresh={() => void refreshAll()}
              onDownloadReport={undefined}
              reportLoading={reportLoading}
            >
              {apiUnreachable && (
                <div className="banner banner-warning" role="status">
                  <div className="banner-content">
                    <div className="banner-title">API Unreachable</div>
                    <div>mastyf.ai API not reachable. Ensure the proxy is running on port 4000 with DASHBOARD_ENABLED=true.</div>
                  </div>
                </div>
              )}

              {/* DASHBOARD */}
              {workspace === 'dashboard' && (
                <ExecutiveDashboard
                  refreshKey={refreshTick}
                  onNavigateAdvanced={(ws, view) => navigate(ws as WorkspaceId, view)}
                />
              )}

              {/* ACTIVITY — Operational Activity Center */}
              {workspace === 'activity' && (
                <ActivityCenter
                  view={activityView}
                  onViewChange={(v) => { setActivityView(v); syncNavToUrl({ workspace: 'activity', view: v }); }}
                  roles={roles}
                  refreshKey={refreshTick}
                  ws={ws}
                  swarmJobStatus={swarmJobStatus}
                  onSwarmStatus={setSwarmJobStatus}
                  onOpenThreats={openThreats}
                  audit={displayAudit}
                  auditAction={auditAction}
                  auditServer={auditServer}
                  onFilterChange={(action, server) => { setAuditAction(action); setAuditServer(server); }}
                  onApplyFilters={() => void refreshAll()}
                  onFpReject={(rule, pattern) => void onFpReject(rule, pattern)}
                  canMutate={hasPermission(roles, 'policy_mutate')}
                />
              )}

              {/* SECURITY — Security Operations Center */}
              {workspace === 'security' && (
                <SecurityOperationsCenter
                  view={securityView}
                  onViewChange={(v) => { setSecurityView(v); syncNavToUrl({ workspace: 'security', view: v }); }}
                  roles={roles}
                  refreshKey={refreshTick}
                  onAction={onAction}
                  threatDiscoveryTick={ws.threatDiscoveryTick}
                  aiRefreshTick={ws.aiRefreshTick}
                  threatLabContext={threatLabContext}
                  threatDiscoverySubTab={threatDiscoverySubTab}
                  onClearThreatLabContext={() => setThreatLabContext(null)}
                  onOpenThreatLab={openThreatLab}
                />
              )}

              {/* POLICY — Policy Control Center */}
              {workspace === 'policy' && (
                <PolicyControlCenter
                  view={policyView}
                  onViewChange={(v) => { setPolicyView(v); syncNavToUrl({ workspace: 'policy', view: v }); }}
                  roles={roles}
                  lastBlocked={lastBlocked ?? null}
                  onAction={onAction}
                  copilotInitialTab={policyCopilotTab}
                />
              )}

              {/* COST — AI Usage & Cost Intelligence */}
              {workspace === 'cost' && (
                <CostIntelligenceCenter
                  view={costView}
                  onViewChange={(v) => { setCostView(v); syncNavToUrl({ workspace: 'cost', view: v }); }}
                  refreshKey={refreshTick}
                  initialCost={cost}
                />
              )}

              {/* SERVERS — Fleet Management */}
              {workspace === 'servers' && (
                <ServersFleetCenter
                  view={serversView}
                  onViewChange={(v) => { setServersView(v); syncNavToUrl({ workspace: 'servers', view: v }); }}
                  health={health}
                  refreshKey={refreshTick}
                />
              )}

              {/* COMPLIANCE — Audit Readiness Center */}
              {workspace === 'compliance' && (
                <ComplianceCenter
                  view={complianceView}
                  onViewChange={(v) => { setComplianceView(v); syncNavToUrl({ workspace: 'compliance', view: v }); }}
                  refreshKey={refreshTick}
                />
              )}

              {/* SETTINGS — Platform Configuration Hub */}
              {workspace === 'settings' && (
                <ConfigurationHub
                  view={settingsView}
                  onViewChange={(v) => { setSettingsView(v); syncNavToUrl({ workspace: 'settings', view: v }); }}
                  roles={roles}
                  tenantLocked={!!authStatus?.tenantLocked}
                  refreshKey={refreshTick}
                  onAction={onAction}
                  onGoToAgentFlow={() => navigate('activity', 'realtime')}
                />
              )}

              {/* LOGS — Centralized Log Viewer */}
              {workspace === 'logs' && (
                <LogsViewer
                  view={logsView}
                  onViewChange={(v) => { setLogsView(v); syncNavToUrl({ workspace: 'logs', view: v }); }}
                  refreshKey={refreshTick}
                />
              )}

              {/* HELP — Operator Enablement Center */}
              {workspace === 'help' && (
                <OperatorEnablementCenter
                  initialTopic={helpTopic}
                  onAction={onAction}
                />
              )}

            </EnterpriseLayout>
          </VisualsProvider>
        </DashboardRegionProvider>
      </DashboardWindowProvider>
    </LoginGate>
  );
}

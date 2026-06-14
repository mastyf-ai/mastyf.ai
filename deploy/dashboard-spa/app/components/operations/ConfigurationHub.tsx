'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Clock, AlertCircle, Cloud, Settings, Globe, Shield, Activity, Server, Key, Webhook, Database, Users, FileText, LogIn, Lock } from 'lucide-react';
import {
  fetchSetupStatus,
  saveSetupMastyfAiConfig,
  fetchSetupCloudStatus,
  connectSetupCloud,
  fetchTenantContext,
  fetchAdminAuditTrail,
  fetchLogs,
  fetchAuthStatus,
  setTenantId,
  getTenantId,
  type SetupStatusResponse,
  type SetupCloudStatus,
  type AuthStatus,
} from '@/lib/mastyf-ai-api';
import { hasPermission } from '@/lib/dashboard-roles';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';

type SettingsView = 'general' | 'tenants' | 'integrations' | 'admin';

type Props = {
  view: SettingsView;
  onViewChange: (v: SettingsView) => void;
  roles?: string[];
  tenantLocked?: boolean;
  onAction?: (msg: string) => void;
  onGoToAgentFlow?: () => void;
};

type ChecklistItem = {
  key: string;
  label: string;
  description: string;
  done: boolean;
  error?: string;
  icon: typeof Activity;
};

export function ConfigurationHub({ view, roles, tenantLocked = false, onAction, onGoToAgentFlow }: Props) {
  const isAdmin = hasPermission(roles, 'admin');

  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(null);
  const [cloudStatus, setCloudStatus] = useState<SetupCloudStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [cloudLoading, setCloudLoading] = useState(false);

  const [upstreamUrl, setUpstreamUrl] = useState('');
  const [listenPort, setListenPort] = useState('8443');
  const [authToken, setAuthToken] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [cloudUrl, setCloudUrl] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [strictness, setStrictness] = useState(50);
  const [keyRotation, setKeyRotation] = useState(false);

  const [tenantId, setTenantIdLocal] = useState('default');
  const [multiTenant, setMultiTenant] = useState(false);
  const [trail, setTrail] = useState<unknown[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [st, cl] = await Promise.all([
      fetchSetupStatus(),
      fetchSetupCloudStatus(),
    ]);
    setSetupStatus(st);
    setCloudStatus(cl);
    if (st?.mastyfAiConfig) {
      setUpstreamUrl(st.mastyfAiConfig.upstreamUrl || '');
      setListenPort(String(st.mastyfAiConfig.listenPort ?? 8443));
    }
    if (cl) {
      setCloudUrl(cl.controlPlaneUrl || '');
      setSsoEnabled(cl.ssoEnabled ?? false);
      setStrictness(cl.policyStrictnessPct ?? 50);
      setKeyRotation(cl.apiKeyRotationEnabled ?? false);
    }
    setLoading(false);
  }, []);

  const loadTenant = useCallback(async () => {
    setTenantIdLocal(getTenantId() || 'default');
    const ctx = await fetchTenantContext();
    if (ctx) {
      setTenantIdLocal(ctx.tenantId);
      setMultiTenant(ctx.multiTenantMode);
    }
  }, []);

  const loadAdmin = useCallback(async () => {
    if (isAdmin) {
      const [entries, logLines, auth] = await Promise.all([
        fetchAdminAuditTrail(),
        fetchLogs(),
        fetchAuthStatus(),
      ]);
      setTrail(entries);
      setLogs(logLines);
      setAuthStatus(auth);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadAll();
    void loadTenant();
  }, [loadAll, loadTenant]);

  useEffect(() => {
    if (view === 'admin') void loadAdmin();
  }, [view, loadAdmin]);

  const onSaveConfig = async () => {
    setSaving(true);
    const res = await saveSetupMastyfAiConfig({
      upstreamUrl,
      listenPort: parseInt(listenPort, 10) || 8443,
      authToken: authToken || undefined,
    });
    setSaving(false);
    if (res.ok) {
      onAction?.('Mastyf AI config saved');
      setConfigOpen(false);
      await loadAll();
    } else {
      onAction?.(res.error || 'Save failed');
    }
  };

  const onConnectCloud = async () => {
    setCloudLoading(true);
    const res = await connectSetupCloud({
      controlPlaneUrl: cloudUrl,
      ssoEnabled,
      policyStrictnessPct: strictness,
      apiKeyRotationEnabled: keyRotation,
    });
    setCloudLoading(false);
    if (res.ok) {
      onAction?.('Cloud connected successfully');
      if (res.launchUrl) window.open(res.launchUrl, '_blank');
      await loadAll();
    } else {
      onAction?.(res.error || 'Cloud connection failed');
    }
  };

  const onDisconnectCloud = async () => {
    setCloudLoading(true);
    await connectSetupCloud({ controlPlaneUrl: '', ssoEnabled: false });
    setCloudLoading(false);
    onAction?.('Cloud disconnected');
    await loadAll();
  };

  const applyTenant = () => {
    setTenantId(tenantId);
    window.location.reload();
  };

  const completed = setupStatus?.completedCount ?? 0;
  const total = setupStatus?.totalSteps ?? 3;
  const configDone = setupStatus?.mastyfAiConfig?.done ?? false;
  const dbDone = setupStatus?.database?.done ?? false;
  const proxyDone = setupStatus?.proxyTraffic?.done ?? false;

  const checklistItems: ChecklistItem[] = [
    { key: 'config', label: 'Mastyf AI Config', description: 'Configure mastyf-ai proxy upstream settings', done: configDone, icon: Settings },
    { key: 'database', label: 'Database Connectivity', description: setupStatus?.database?.version || 'Auto-detect database connection', done: dbDone, error: setupStatus?.database?.error, icon: Database },
    { key: 'proxy', label: 'Proxy Traffic', description: proxyDone ? `Healthy — ${setupStatus?.proxyTraffic?.totalCalls?.toLocaleString() ?? 0} requests routed` : 'Waiting for traffic…', done: proxyDone, icon: Activity },
  ];

  return (
    <div className="configuration-hub">
      {view === 'general' && (
        <div className="configuration-general">
          <Card title="Setup Progress" subtitle="Guided setup checklist">
            {loading ? (
              <p className="text-sm text-muted">Loading setup status…</p>
            ) : (
              <div className="setup-checklist">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm text-muted">{completed}/{total} completed</span>
                  <div className="setup-progress-bar" style={{ width: `${total ? (completed / total) * 100 : 0}%`, height: 4, background: 'var(--bg-muted)', borderRadius: 2, flex: 1 }}>
                    <div style={{ width: `${total ? (completed / total) * 100 : 0}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s' }} />
                  </div>
                </div>
                <ul className="setup-checklist-items" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {checklistItems.map((item) => (
                    <li key={item.key} className={`setup-check-item ${item.done ? 'done' : ''}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ flexShrink: 0, marginTop: 2 }}>
                        {item.done ? (
                          <CheckCircle size={18} className="text-success" />
                        ) : item.error ? (
                          <AlertCircle size={18} className="text-danger" />
                        ) : (
                          <Clock size={18} className="text-muted" />
                        )}
                      </span>
                      <div className="setup-check-body" style={{ flex: 1 }}>
                        {item.key === 'config' ? (
                          <>
                            <button type="button" className="setup-check-title linkish" onClick={() => setConfigOpen((o) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0, fontSize: 'inherit' }}>
                              {item.label}
                            </button>
                            <p className="text-sm text-muted">{item.description}</p>
                            {configOpen && (
                              <div className="setup-config-form" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  Upstream URL
                                  <input type="url" className="input" value={upstreamUrl} onChange={(e) => setUpstreamUrl(e.target.value)} style={{ width: '100%' }} />
                                </label>
                                <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  Listen Port
                                  <input type="number" className="input" value={listenPort} onChange={(e) => setListenPort(e.target.value)} style={{ width: 120 }} />
                                </label>
                                <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  Auth Token
                                  <input type="password" className="input" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="grd_sk_live_…" style={{ width: '100%' }} />
                                </label>
                                <Button variant="primary" size="sm" onClick={() => void onSaveConfig()} disabled={saving}>
                                  {saving ? 'Saving…' : 'Save Configuration'}
                                </Button>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <strong>{item.label}</strong>
                            {item.error && <p className="text-sm text-danger">{item.error}</p>}
                            {!item.error && <p className="text-sm text-muted">{item.description}</p>}
                          </>
                        )}
                      </div>
                      {item.done && <CheckCircle size={16} className="text-success" style={{ flexShrink: 0, marginTop: 3 }} />}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card title="Cloud Connection" subtitle="Connect to Mastyf AI control plane">
            <div className="cloud-connection" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="flex items-center gap-2">
                <Cloud size={18} />
                <span className="text-sm">
                  Status:{' '}
                  {cloudStatus?.connected ? (
                    <Badge variant="success" dot>Connected</Badge>
                  ) : (
                    <Badge variant="neutral" dot>Disconnected</Badge>
                  )}
                </span>
              </div>
              {cloudStatus?.connected ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {cloudStatus.controlPlaneUrl && (
                    <p className="text-sm text-muted">Control Plane: {cloudStatus.controlPlaneUrl}</p>
                  )}
                  <Button variant="danger" size="sm" onClick={() => void onDisconnectCloud()} disabled={cloudLoading}>
                    Disconnect
                  </Button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    Control Plane URL
                    <input type="url" className="input" value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)} placeholder="https://cloud.mastyf.ai" style={{ width: '100%' }} />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={ssoEnabled} onChange={(e) => setSsoEnabled(e.target.checked)} />
                    Enable SSO
                  </label>
                  <label className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    Policy Strictness ({strictness}%)
                    <input type="range" min={0} max={100} value={strictness} onChange={(e) => setStrictness(Number(e.target.value))} />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={keyRotation} onChange={(e) => setKeyRotation(e.target.checked)} />
                    Auto Key Rotation
                  </label>
                  <Button variant="primary" size="sm" onClick={() => void onConnectCloud()} disabled={cloudLoading || !cloudUrl}>
                    {cloudLoading ? 'Connecting…' : 'Connect to Cloud'}
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card title="CLI Onboarding" subtitle="Quick start commands">
            {setupStatus?.onboarding ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <pre className="code-block setup-cmd" style={{ background: 'var(--bg-muted)', padding: 10, borderRadius: 6, fontSize: 12, overflow: 'auto' }}>
                  {setupStatus.onboarding.commands.onboard}
                </pre>
                <pre className="code-block setup-cmd" style={{ background: 'var(--bg-muted)', padding: 10, borderRadius: 6, fontSize: 12, overflow: 'auto' }}>
                  {setupStatus.onboarding.commands.dashboardProxy}
                </pre>
                {onGoToAgentFlow && (
                  <Button variant="secondary" size="sm" onClick={onGoToAgentFlow}>
                    Open Agent Flow
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">Onboarding commands not available.</p>
            )}
          </Card>
        </div>
      )}

      {view === 'tenants' && (
        <div className="configuration-tenants">
          <Card title="Tenant Configuration" subtitle="Manage multi-tenant isolation settings">
            <div className="tenant-config" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {tenantLocked ? (
                <span className="text-sm text-secondary">
                  Tenant ID: <strong>{tenantId}</strong>
                  <span className="text-muted" style={{ marginLeft: 8 }}>(session-bound)</span>
                </span>
              ) : (
                <div className="flex items-center gap-2" style={{ flex: 1 }}>
                  <span className="text-sm text-muted">Tenant ID:</span>
                  <input
                    type="text"
                    className="input"
                    style={{ width: 220 }}
                    value={tenantId}
                    onChange={(e) => setTenantIdLocal(e.target.value)}
                  />
                  <Button size="sm" onClick={applyTenant}>Apply & reload</Button>
                </div>
              )}
              {multiTenant && <Badge variant="info">Multi-tenant mode</Badge>}
            </div>
          </Card>
          <Card title="Current Tenant Info" subtitle="Active session details">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="flex items-center gap-2 text-sm">
                <Users size={16} className="text-muted" />
                <span>Tenant: <strong>{tenantId}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Shield size={16} className="text-muted" />
                <span>Mode: {multiTenant ? 'Multi-tenant' : 'Single-tenant'}</span>
              </div>
              {tenantLocked && (
                <div className="flex items-center gap-2 text-sm">
                  <Lock size={16} className="text-muted" />
                  <span className="text-warning">Tenant is session-locked</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {view === 'integrations' && (
        <div className="configuration-integrations">
          <Card title="Cloud Control Plane" subtitle="Connection status and management">
            <div className="flex items-center gap-2">
              <Globe size={18} />
              <span className="text-sm">
                {cloudStatus?.connected ? (
                  <>
                    Connected to <strong>{cloudStatus.controlPlaneUrl || 'control plane'}</strong>
                    <span style={{ marginLeft: 8 }}><Badge variant="success" dot>Live</Badge></span>
                  </>
                ) : (
                  <span className="text-muted">Not connected — configure in General view</span>
                )}
              </span>
            </div>
          </Card>

          <Card title="Webhooks" subtitle="Configure outgoing webhook notifications">
            <EmptyState
              icon={Webhook}
              title="Webhook integration"
              message="Configure webhook endpoints for real-time event notifications."
            />
          </Card>

          <Card title="SIEM Integration" subtitle="Forward audit logs to your SIEM">
            <EmptyState
              icon={FileText}
              title="SIEM connector"
              message="Send structured audit events to Splunk, Elastic, or other SIEM platforms."
            />
          </Card>

          <Card>
            <div className="flex items-center justify-center gap-2 text-sm text-muted" style={{ padding: '8px 0' }}>
              <Activity size={16} />
              More integrations coming soon
            </div>
          </Card>
        </div>
      )}

      {view === 'admin' && (
        <div className="configuration-admin">
          {isAdmin ? (
            <>
              <Card title="Policy Audit Trail" subtitle="Recent admin actions and configuration changes">
                {trail.length === 0 ? (
                  <p className="text-sm text-muted">No audit trail entries.</p>
                ) : (
                  <div className="audit-table-wrapper" style={{ overflow: 'auto' }}>
                    <table className="audit-table" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px' }}>Timestamp</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px' }}>Action</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px' }}>Actor</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px' }}>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(trail as Array<{ timestamp?: string; action?: string; actor?: string; detail?: string }>).slice(0, 50).map((entry, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{entry.timestamp || '-'}</td>
                            <td style={{ padding: '6px 8px' }}>{entry.action || '-'}</td>
                            <td style={{ padding: '6px 8px' }}>{entry.actor || '-'}</td>
                            <td style={{ padding: '6px 8px' }}>{entry.detail || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title="Operational Logs" subtitle="Swarm job and system logs">
                {logs.length === 0 ? (
                  <p className="text-sm text-muted">No log lines available.</p>
                ) : (
                  <pre className="mono" style={{ fontSize: 11, background: 'var(--bg-muted)', padding: 12, borderRadius: 6, overflow: 'auto', maxHeight: 300, lineHeight: 1.4 }}>
                    {logs.join('\n')}
                  </pre>
                )}
              </Card>

              <Card title="Auth / RBAC Status" subtitle="Authentication and role-based access control">
                {authStatus ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                    <div className="flex items-center gap-2">
                      <Shield size={16} className="text-muted" />
                      <span>Auth {authStatus.authConfigured ? 'Configured' : 'Not configured'}</span>
                      {authStatus.authenticated ? (
                        <Badge variant="success" dot>Authenticated</Badge>
                      ) : (
                        <Badge variant="warning" dot>Not authenticated</Badge>
                      )}
                    </div>
                    {authStatus.identity && (
                      <div className="flex items-center gap-2">
                        <LogIn size={16} className="text-muted" />
                        <span>Identity: {authStatus.identity}</span>
                      </div>
                    )}
                    {authStatus.roles && authStatus.roles.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Key size={16} className="text-muted" />
                        <span>Roles: {authStatus.roles.join(', ')}</span>
                      </div>
                    )}
                    {authStatus.sessionTenantId && (
                      <div className="flex items-center gap-2">
                        <Users size={16} className="text-muted" />
                        <span>Session tenant: {authStatus.sessionTenantId}</span>
                      </div>
                    )}
                    {authStatus.tier && (
                      <div className="flex items-center gap-2">
                        <Server size={16} className="text-muted" />
                        <span>Tier: {authStatus.tier}{authStatus.licensed ? ' (licensed)' : ' (unlicensed)'}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Loading auth status…</p>
                )}
              </Card>

              <Card title="Session Management" subtitle="Current session info">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-muted" />
                    <span>Tenant: {getTenantId() || 'default'}</span>
                  </div>
                  {authStatus?.sessionTenantId && (
                    <div className="flex items-center gap-2">
                      <Server size={16} className="text-muted" />
                      <span>Session Tenant: {authStatus.sessionTenantId}</span>
                    </div>
                  )}
                  {authStatus?.multiTenantMode && (
                    <Badge variant="info">Multi-tenant session</Badge>
                  )}
                </div>
              </Card>
            </>
          ) : (
            <Card>
              <p className="text-sm text-muted">Admin role required for audit trail, logs, and auth configuration.</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

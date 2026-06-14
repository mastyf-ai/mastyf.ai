'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchTenantContext,
  fetchAdminAuditTrail,
  fetchLogs,
  fetchAuthStatus,
  fetchSetupStatus,
  setTenantId,
  getTenantId,
  type SetupStatusResponse,
} from '@/lib/mastyf-ai-api';
import { hasPermission } from '@/lib/dashboard-roles';
import { Card } from '@/app/components/ui/Card';
import { Button } from '@/app/components/ui/Button';
import { Badge } from '@/app/components/ui/Badge';
import { KpiCard } from '@/app/components/ui/KpiCard';
import { EmptyState } from '@/app/components/ui/EmptyState';

type Props = {
  roles?: string[];
  tenantLocked?: boolean;
  onAction?: (msg: string) => void;
};

export function GovernanceCenter({ roles, tenantLocked = false, onAction }: Props) {
  const isAdmin = hasPermission(roles, 'admin');

  const [tenantId, setTenantIdState] = useState('default');
  const [multiTenantMode, setMultiTenantMode] = useState(false);
  const [authStatus, setAuthStatus] = useState<{
    authenticated: boolean;
    authRequired: boolean;
    identity?: string;
    roles?: string[];
    tenantId?: string;
    multiTenantMode?: boolean;
    licensed?: boolean;
    tier?: string;
    features?: string[];
  } | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(null);
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [inputTenantId, setInputTenantId] = useState('');
  const [logFilter, setLogFilter] = useState('');
  const [showRawAudit, setShowRawAudit] = useState(false);

  const refresh = useCallback(async () => {
    const stored = getTenantId();
    if (stored) setTenantIdState(stored);

    try {
      const ctx = await fetchTenantContext();
      if (ctx) {
        setTenantIdState(ctx.tenantId);
        setMultiTenantMode(ctx.multiTenantMode);
      }
    } catch { /* ignore */ }

    try {
      const auth = await fetchAuthStatus();
      setAuthStatus(auth);
    } catch { /* ignore */ }

    try {
      const setup = await fetchSetupStatus();
      setSetupStatus(setup);
    } catch { /* ignore */ }

    if (isAdmin) {
      try {
        const trail = await fetchAdminAuditTrail();
        setAuditEntries(trail ?? []);
      } catch { /* ignore */ }

      try {
        const result = await fetchLogs();
        setLogs(result ?? []);
      } catch { /* ignore */ }
    }
  }, [isAdmin]);

  useEffect(() => { void refresh(); }, [refresh]);

  const applyTenant = useCallback(() => {
    setTenantId(inputTenantId);
    onAction?.(`Tenant ID set to ${inputTenantId}, reloading…`);
    setTimeout(() => window.location.reload(), 300);
  }, [inputTenantId, onAction]);

  const roleCount = useMemo(() => {
    if (authStatus?.roles?.length) return authStatus.roles.length;
    if (roles?.length) return roles.length;
    return 0;
  }, [authStatus?.roles, roles]);

  const filteredLogs = useMemo(() => {
    if (!logFilter) return logs.slice(-50);
    return logs.filter((l) => l.toLowerCase().includes(logFilter.toLowerCase())).slice(-50);
  }, [logs, logFilter]);

  const setupChecks = useMemo(() => {
    if (!setupStatus) return [];
    return [
      { label: 'Configuration', ok: setupStatus.mastyfAiConfig?.done ?? false },
      { label: 'Database', ok: setupStatus.database?.done ?? false },
      { label: 'Proxy Traffic', ok: setupStatus.proxyTraffic?.done ?? false },
    ];
  }, [setupStatus]);

  const displayRoles = useMemo(() => {
    return authStatus?.roles ?? roles ?? [];
  }, [authStatus?.roles, roles]);

  return (
    <section className="governance-center" aria-label="Governance & Compliance Center">
      {/* Section 1: Compliance Posture Overview */}
      <div className="governance-kpi-row">
        <KpiCard
          label="Auth Status"
          value={authStatus?.authenticated ? 'Authenticated' : 'Not Authenticated'}
          accent={authStatus?.authenticated ? 'success' : 'danger'}
        />
        <KpiCard
          label="RBAC Roles"
          value={roleCount}
          accent={roleCount > 0 ? 'info' : 'neutral'}
        />
        <KpiCard
          label="Tenant Mode"
          value={multiTenantMode ? 'Multi-tenant' : 'Single-tenant'}
          accent={multiTenantMode ? 'warning' : 'info'}
        />
        <KpiCard
          label="License Tier"
          value={authStatus?.tier ?? (authStatus?.licensed ? 'Licensed' : 'Unlicensed')}
          accent={authStatus?.licensed ? 'success' : 'warning'}
        />
      </div>

      <div className="governance-posture-grid">
        <Card
          title="Authentication & Identity"
          subtitle="Current auth session details"
        >
          {authStatus ? (
            <div className="governance-auth-details">
              <div className="governance-detail-row">
                <span className="governance-detail-label">Authenticated</span>
                <Badge
                  variant={authStatus.authenticated ? 'success' : 'danger'}
                  dot
                >
                  {authStatus.authenticated ? 'Yes' : 'No'}
                </Badge>
              </div>
              {authStatus.identity && (
                <div className="governance-detail-row">
                  <span className="governance-detail-label">Identity</span>
                  <span className="governance-detail-value">{authStatus.identity}</span>
                </div>
              )}
              {displayRoles.length > 0 && (
                <div className="governance-detail-row">
                  <span className="governance-detail-label">Roles</span>
                  <div className="governance-role-badges">
                    {displayRoles.map((role) => (
                      <Badge key={role} variant="info">{role}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {authStatus.authRequired && (
                <div className="governance-detail-row">
                  <span className="governance-detail-label">Auth Required</span>
                  <Badge variant="warning" dot>Yes</Badge>
                </div>
              )}
            </div>
          ) : (
            <EmptyState title="No auth data" message="Auth status not available." />
          )}
        </Card>

        <Card
          title="Tenant Context"
          subtitle="Isolation settings"
        >
          <div className="governance-auth-details">
            <div className="governance-detail-row">
              <span className="governance-detail-label">Tenant ID</span>
              <span className="governance-detail-value">{tenantId}</span>
            </div>
            <div className="governance-detail-row">
              <span className="governance-detail-label">Mode</span>
              <Badge variant={multiTenantMode ? 'warning' : 'info'}>
                {multiTenantMode ? 'Multi-tenant' : 'Single-tenant'}
              </Badge>
            </div>
          </div>
        </Card>

        <Card
          title="Setup Status"
          subtitle="System readiness checks"
        >
          {setupChecks.length > 0 ? (
            <div className="governance-checklist">
              {setupChecks.map((check) => (
                <div key={check.label} className="governance-check-row">
                  <span className={`governance-check-icon ${check.ok ? 'ok' : 'fail'}`}>
                    {check.ok ? '✓' : '✗'}
                  </span>
                  <span className="governance-check-label">{check.label}</span>
                  <Badge variant={check.ok ? 'success' : 'danger'}>{check.ok ? 'OK' : 'FAIL'}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No setup data" message="Setup status not available." />
          )}
          {setupStatus?.mastyfAiConfig && (
            <div className="governance-detail">
              <span className="governance-detail-label">Proxy URL:</span>
              <span className="governance-detail-value">{setupStatus.mastyfAiConfig.upstreamUrl}</span>
              <span className="governance-detail-label">Listen port:</span>
              <span className="governance-detail-value">{setupStatus.mastyfAiConfig.listenPort}</span>
            </div>
          )}
        </Card>
      </div>

      {/* Section 2: Access & Audit */}
      <Card
        title="Admin Audit Trail"
        subtitle="Last 20 configuration changes"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowRawAudit((v) => !v)}
          >
            {showRawAudit ? 'Table View' : 'Raw JSON'}
          </Button>
        }
      >
        {!isAdmin ? (
          <p className="text-sm text-muted">Admin role required to view audit trail.</p>
        ) : auditEntries.length === 0 ? (
          <EmptyState title="No audit entries" message="No audit trail data available." />
        ) : showRawAudit ? (
          <pre className="governance-raw-json">
            {JSON.stringify(auditEntries.slice(0, 20), null, 2)}
          </pre>
        ) : (
          <div className="governance-audit-table-wrapper">
            <table className="governance-audit-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Action</th>
                  <th>Timestamp</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.slice(0, 20).map((entry: any, idx: number) => (
                  <tr key={entry.id ?? idx}>
                    <td className="governance-cell-mono">{entry.id ?? '—'}</td>
                    <td>
                      <Badge variant="info">{entry.action ?? '—'}</Badge>
                    </td>
                    <td className="governance-cell-mono">{entry.timestamp ?? '—'}</td>
                    <td className="governance-cell-details">
                      {typeof entry.details === 'object' && entry.details !== null
                        ? JSON.stringify(entry.details)
                        : String(entry.details ?? '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Operational Logs"
        subtitle="Swarm job and system logs (last 50)"
        actions={
          <div className="governance-log-search">
            <input
              type="text"
              className="input"
              placeholder="Filter logs…"
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              aria-label="Filter logs"
            />
          </div>
        }
      >
        {!isAdmin ? (
          <p className="text-sm text-muted">Admin role required to view logs.</p>
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            title="No log lines"
            message={logFilter ? 'No logs match your filter.' : 'No log lines available.'}
          />
        ) : (
          <pre className="governance-logs-pre">
            {filteredLogs.join('\n')}
          </pre>
        )}
      </Card>

      {/* Section 3: Governance Controls */}
      <Card
        title="Governance Controls"
        subtitle="Tenant & RBAC management"
      >
        <div className="governance-controls-grid">
          <div className="governance-control-section">
            <h4 className="governance-control-heading">Tenant ID Configuration</h4>
            {tenantLocked ? (
              <div className="governance-detail-row">
                <span className="governance-detail-label">Tenant ID</span>
                <span className="governance-detail-value">
                  {tenantId}
                  <Badge variant="info" className="governance-locked-badge">session-bound</Badge>
                </span>
              </div>
            ) : (
              <div className="governance-tenant-input-row">
                <input
                  type="text"
                  className="input"
                  placeholder={tenantId}
                  value={inputTenantId}
                  onChange={(e) => setInputTenantId(e.target.value)}
                  aria-label="Set tenant ID"
                />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={applyTenant}
                  disabled={!inputTenantId.trim()}
                >
                  Apply
                </Button>
              </div>
            )}
          </div>

          <div className="governance-control-section">
            <h4 className="governance-control-heading">RBAC Permissions</h4>
            <div className="governance-detail-row">
              <span className="governance-detail-label">Effective Roles</span>
              <div className="governance-role-badges">
                {displayRoles.length > 0
                  ? displayRoles.map((role) => (
                      <Badge key={role} variant="info">{role}</Badge>
                    ))
                  : <span className="text-sm text-muted">No roles assigned</span>}
              </div>
            </div>
            <div className="governance-detail-row">
              <span className="governance-detail-label">Admin Access</span>
              <Badge variant={isAdmin ? 'success' : 'neutral'} dot>
                {isAdmin ? 'Granted' : 'Restricted'}
              </Badge>
            </div>
          </div>

          <div className="governance-control-section">
            <h4 className="governance-control-heading">Licensing</h4>
            <div className="governance-detail-row">
              <span className="governance-detail-label">Status</span>
              <Badge variant={authStatus?.licensed ? 'success' : 'warning'} dot>
                {authStatus?.licensed ? 'Licensed' : 'Unlicensed'}
              </Badge>
            </div>
            {authStatus?.tier && (
              <div className="governance-detail-row">
                <span className="governance-detail-label">Tier</span>
                <span className="governance-detail-value">{authStatus.tier}</span>
              </div>
            )}
            {authStatus?.features && authStatus.features.length > 0 && (
              <div className="governance-detail-row">
                <span className="governance-detail-label">Features</span>
                <div className="governance-role-badges">
                  {authStatus.features.map((f) => (
                    <Badge key={f} variant="success">{f}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchSecurityDashboard,
  quarantineAllThreats,
  quarantineSecurityThreat,
  type SecurityDashboardResponse,
  type SecurityDashboardThreat,
} from '@/lib/mastyf-ai-api';
import { hasPermission } from '@/lib/dashboard-roles';
import type { WorkspaceId } from '@/lib/workspace-nav';
import { DataTablePro, type Column } from '../dashboard/DataTablePro';
import { Button } from '../ui/Button';

type Props = {
  refreshKey?: number;
  roles?: string[];
  onNavigate?: (workspace: WorkspaceId, view?: string) => void;
  onAction?: (msg: string) => void;
};

const QUICK_NAV = [
  { workspace: 'security' as const, view: 'overview', label: 'Dashboard' },
  { workspace: 'security' as const, view: 'threats', label: 'Threat Detection' },
  { workspace: 'activity' as const, view: 'audit', label: 'Audit Log' },
  { workspace: 'settings' as const, view: 'admin', label: 'Access Control' },
  { workspace: 'policy' as const, view: 'rules', label: 'Policies' },
] as const;

function severityClass(s: SecurityDashboardThreat['severity']): string {
  return `severity-badge severity-${s}`;
}

function statusClass(s: SecurityDashboardThreat['status']): string {
  return `threat-status threat-status-${s}`;
}

export function SecurityDashboardPanel({ refreshKey = 0, roles = [], onNavigate, onAction }: Props) {
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [data, setData] = useState<SecurityDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setData(await fetchSecurityDashboard('24h'));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const onQuarantineAll = async () => {
    if (!canMutate) {
      onAction?.('Requires operator role to quarantine threats');
      return;
    }
    const count = (data?.threats ?? []).filter(
      (t) => t.severity === 'critical' || t.severity === 'high',
    ).length;
    if (!count) {
      onAction?.('No high-severity threats to quarantine');
      return;
    }
    if (
      !window.confirm(
        `Quarantine ${count} high/critical threat(s)? This will hide them from Threat Monitor and apply or confirm hardening policy rules. Quarantined records are listed under Security → Quarantined.`,
      )
    ) {
      return;
    }
    setBusy('quarantine-all');
    const res = await quarantineAllThreats('24h');
    if (res.ok) {
      onAction?.(`Quarantined ${res.quarantined ?? 0} threat(s) with enforcement checks — see Security → Quarantined`);
      await load();
    } else {
      onAction?.(res.error || 'Quarantine failed');
    }
    setBusy('');
  };

  const onQuarantineOne = async (row: SecurityDashboardThreat) => {
    if (!canMutate) {
      onAction?.('Requires operator role to quarantine threats');
      return;
    }
    if (
      !window.confirm(
        `Quarantine ${row.id} (${row.type})? This will hide it from Threat Monitor and apply or confirm hardening policy.`,
      )
    ) {
      return;
    }
    const payload = { ...row, threatKey: row.threatKey || row.id };
    setBusy(payload.threatKey);
    const res = await quarantineSecurityThreat(payload, undefined, '24h');
    if (res.ok) {
      if (res.enforcementStatus === 'applied') {
        onAction?.(`Quarantined ${row.id}. Applied policy rule ${res.appliedRuleName || 'for threat hardening'}.`);
      } else if (res.enforcementStatus === 'already_blocked') {
        onAction?.(`Quarantined ${row.id}. Threat is already blocked by policy.`);
      } else if (res.enforcementStatus === 'already_present') {
        onAction?.(`Quarantined ${row.id}. Matching policy rule already exists.`);
      } else if (res.enforcementStatus === 'no_context') {
        onAction?.(`Quarantined ${row.id}. Archived without new rule (no source context).`);
      } else {
        onAction?.(`Quarantined ${row.id}.`);
      }
      await load();
    } else {
      onAction?.(res.error || 'Quarantine failed');
    }
    setBusy('');
  };

  const onExport = () => {
    const rows = data?.threats ?? [];
    if (!rows.length) {
      onAction?.('No threats to export');
      return;
    }
    const header = 'id,type,source,severity,status\n';
    const body = rows.map((r) => `${r.id},${r.type},${r.source},${r.severity},${r.status}`).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mastyf-ai-threats.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<SecurityDashboardThreat>[] = [
    { key: 'id', header: 'Threat ID', render: (r) => r.id },
    { key: 'type', header: 'Type', render: (r) => r.type },
    { key: 'source', header: 'Source', render: (r) => r.source },
    {
      key: 'severity',
      header: 'Severity',
      render: (r) => <span className={severityClass(r.severity)}>{r.severity.toUpperCase()}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <span className={statusClass(r.status)}>{r.status}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) =>
        canMutate ? (
          <button
            type="button"
            className="secondary btn-sm"
            disabled={!!busy}
            onClick={() => void onQuarantineOne(r)}
          >
            {busy === (r.threatKey || r.id) ? 'Quarantining…' : 'Quarantine'}
          </button>
        ) : (
          '—'
        ),
    },
  ];

  const score = data?.securityScore ?? null;
  const scorePct = score != null ? score : 0;
  const displayRoles = roles.length ? roles : ['viewer'];

  return (
    <section className="security-dashboard" aria-label="Security Dashboard">
      <nav className="security-quick-nav" aria-label="Security sections">
        {QUICK_NAV.map((item) => (
          <button
            key={`${item.workspace}-${item.view}`}
            type="button"
            className={'security-quick-nav-item'}
            onClick={() => onNavigate?.(item.workspace, item.view)}
          >
            {item.label}
          </button>
        ))}
        <span className="security-live-pill">
          <span className="analytics-live-dot" aria-hidden />
          Live Monitoring
        </span>
      </nav>

      <div className="security-dashboard-grid">
        <div className="security-dashboard-left">
          <div className="security-score-card">
            <h3>Security Score</h3>
            <div
              className="security-score-ring"
              style={{ '--score-pct': `${scorePct}` } as React.CSSProperties}
              aria-label={score != null ? `Security score ${score} out of 100` : 'No score'}
            >
              <span className="security-score-value">{score != null ? score : '—'}</span>
              <span className="security-score-max">/ 100</span>
            </div>
            <p className={`security-score-label score-${(data?.scoreLabel || 'unknown').toLowerCase().replace(/\s+/g, '-')}`}>
              {data?.scoreLabel ?? '—'}
            </p>
          </div>

          <div className="security-layers-card">
            <h3>Threat Status</h3>
            <ul>
              {(data?.layers ?? []).map((l) => (
                <li key={l.id}>
                  <span className={`layer-dot ${l.status}`} aria-hidden />
                  <span>{l.label}</span>
                  <span className="layer-status-text">{l.status === 'secure' ? 'Secure' : 'Alert'}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="security-exec-card">
            <h3>Executive Summary</h3>
            <ul>
              {(data?.executiveSummary ?? []).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="security-dashboard-right">
          <div className="security-threat-card">
            <div className="security-threat-head">
              <h3>
                Threat Monitor{' '}
                <span className="threat-active-badge">{data?.activeThreatCount ?? 0} active</span>
              </h3>
              <div className="btn-row">
                <Button
                  variant="primary"
                  onClick={() => void onQuarantineAll()}
                  disabled={!!busy || !canMutate}
                  title={!canMutate ? 'Requires operator role' : undefined}
                >
                  {busy === 'quarantine-all' ? 'Quarantining…' : 'Quarantine All'}
                </Button>
                <Button variant="secondary" onClick={onExport}>
                  Export
                </Button>
              </div>
            </div>
            {loading ? (
              <p className="hint">Loading threats…</p>
            ) : (
              <DataTablePro
                columns={columns}
                rows={data?.threats ?? []}
                rowKey={(r) => r.id}
                exportFilename="mastyf-ai-threat-monitor.csv"
              />
            )}
            <footer className="security-threat-footer">
              <span>
                <span className={`layer-dot ${data?.semanticEngineActive ? 'secure' : 'alert'}`} />
                Semantic Audit Engine {data?.semanticEngineActive ? 'Active' : 'Off'}
              </span>
              <span>Auto-block: {data?.autoBlockOn ? 'ON' : 'OFF'}</span>
              <span>
                Latency: {data?.auditLatencyMs != null ? `${data.auditLatencyMs}ms` : '—'}
              </span>
            </footer>
          </div>

          <div className="security-rbac-card">
            <h3>RBAC Policy</h3>
            <p className="hint">{data?.rbacPolicy ?? 'Defense-In-Depth'}</p>
            <div className="security-role-chips">
              {['admin', 'analyst', 'viewer'].map((role) => (
                <span
                  key={role}
                  className={
                    displayRoles.some((r) => r.toLowerCase().includes(role))
                      ? 'security-role-chip active'
                      : 'security-role-chip'
                  }
                >
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

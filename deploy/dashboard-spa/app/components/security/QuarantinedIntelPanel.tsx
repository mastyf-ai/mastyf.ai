'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchIntelQuarantinePolicy,
  fetchMonitorQuarantinePolicy,
  fetchQuarantinedThreats,
  fetchSecurityQuarantinedThreats,
  restoreSecurityThreat,
  restoreThreatIntel,
  type QuarantinePolicyDetail,
  type QuarantineRecord,
  type SecurityMonitorQuarantineRecord,
} from '@/lib/guardian-api';
import { hasPermission } from '@/lib/dashboard-roles';
import { DataTablePro, type Column } from '../dashboard/DataTablePro';
import { QuarantinePolicyDrawer } from './QuarantinePolicyDrawer';

type Props = {
  roles?: string[];
  onAction?: (msg: string) => void;
};

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function QuarantinedIntelPanel({ roles, onAction }: Props) {
  const canMutate = hasPermission(roles, 'policy_mutate');
  const [intelRows, setIntelRows] = useState<QuarantineRecord[]>([]);
  const [monitorRows, setMonitorRows] = useState<SecurityMonitorQuarantineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyDetail, setPolicyDetail] = useState<QuarantinePolicyDetail | null>(null);
  const [policyError, setPolicyError] = useState('');
  const [policyBusyKey, setPolicyBusyKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [intel, monitor] = await Promise.all([
      fetchQuarantinedThreats(30),
      fetchSecurityQuarantinedThreats(30),
    ]);
    setIntelRows(intel);
    setMonitorRows(monitor);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openIntelPolicy = async (row: QuarantineRecord) => {
    setPolicyOpen(true);
    setPolicyLoading(true);
    setPolicyError('');
    setPolicyDetail(null);
    setPolicyBusyKey(`intel:${row.id}`);
    const { detail, error } = await fetchIntelQuarantinePolicy(row);
    setPolicyDetail(detail);
    setPolicyError(error || (!detail ? 'Policy detail unavailable' : ''));
    setPolicyLoading(false);
    setPolicyBusyKey('');
  };

  const openMonitorPolicy = async (row: SecurityMonitorQuarantineRecord) => {
    setPolicyOpen(true);
    setPolicyLoading(true);
    setPolicyError('');
    setPolicyDetail(null);
    setPolicyBusyKey(`monitor:${row.threatKey}`);
    const { detail, error } = await fetchMonitorQuarantinePolicy(row);
    setPolicyDetail(detail);
    setPolicyError(error || (!detail ? 'Policy detail unavailable' : ''));
    setPolicyLoading(false);
    setPolicyBusyKey('');
  };

  const onRestoreIntel = async (id: string) => {
    if (!canMutate) {
      onAction?.('Requires operator role');
      return;
    }
    if (!window.confirm(`Restore ${id} to active catalog? This does not rollback applied policy rules.`)) return;
    setBusyId(`intel:${id}`);
    const res = await restoreThreatIntel(id);
    if (res.ok) {
      onAction?.(`Restored ${id} to active threat catalog`);
      setPolicyOpen(false);
      await load();
    } else {
      onAction?.(res.error || 'Restore failed');
    }
    setBusyId('');
  };

  const onRestoreMonitor = async (threatKey: string, displayId: string) => {
    if (!canMutate) {
      onAction?.('Requires operator role');
      return;
    }
    if (!window.confirm(`Restore ${displayId} to Threat Monitor?`)) return;
    const removeRule = window.confirm(
      `Also remove the applied quarantine policy rule for ${displayId}?\n\nChoose OK to remove rule, Cancel to keep rule.`,
    );
    setBusyId(`monitor:${threatKey}`);
    const res = await restoreSecurityThreat(threatKey, { removeRule });
    if (res.ok) {
      onAction?.(
        removeRule
          ? `Restored ${displayId} and ${res.removedRule ? 'removed' : 'could not remove'} quarantine rule`
          : `Restored ${displayId} to Threat Monitor (kept policy rule)`,
      );
      setPolicyOpen(false);
      await load();
    } else {
      onAction?.(res.error || 'Restore failed');
    }
    setBusyId('');
  };

  const policyColumnIntel: Column<QuarantineRecord> = {
    key: 'policy',
    header: 'Policy',
    render: (r) => (
      <button
        type="button"
        className="secondary btn-sm"
        disabled={policyBusyKey === `intel:${r.id}`}
        onClick={() => void openIntelPolicy(r)}
      >
        {policyBusyKey === `intel:${r.id}` ? 'Loading…' : 'View policy'}
      </button>
    ),
  };

  const policyColumnMonitor: Column<SecurityMonitorQuarantineRecord> = {
    key: 'policy',
    header: 'Policy',
    render: (r) => (
      <button
        type="button"
        className="secondary btn-sm"
        disabled={policyBusyKey === `monitor:${r.threatKey}`}
        onClick={() => void openMonitorPolicy(r)}
      >
        {policyBusyKey === `monitor:${r.threatKey}` ? 'Loading…' : 'View policy'}
      </button>
    ),
  };

  const intelColumns: Column<QuarantineRecord>[] = [
    { key: 'id', header: 'Threat ID', render: (r) => <code>{r.id}</code> },
    { key: 'source', header: 'Source', render: (r) => r.source },
    { key: 'severity', header: 'Severity', render: (r) => r.severity },
    { key: 'at', header: 'Quarantined at', render: (r) => formatTs(r.quarantinedAt), sortValue: (r) => r.quarantinedAt },
    { key: 'operator', header: 'Operator', render: (r) => r.operator || '—' },
    { key: 'description', header: 'Description', render: (r) => r.description?.slice(0, 140) || '—' },
    policyColumnIntel,
    {
      key: 'actions',
      header: 'Actions',
      render: (r) =>
        canMutate ? (
          <button
            type="button"
            className="secondary btn-sm"
            disabled={busyId === `intel:${r.id}`}
            onClick={() => void onRestoreIntel(r.id)}
          >
            {busyId === `intel:${r.id}` ? 'Restoring…' : 'Restore'}
          </button>
        ) : (
          '—'
        ),
    },
  ];

  const monitorColumns: Column<SecurityMonitorQuarantineRecord>[] = [
    { key: 'id', header: 'Threat ID', render: (r) => <code>{r.id}</code> },
    { key: 'type', header: 'Type', render: (r) => r.type },
    { key: 'source', header: 'Source', render: (r) => r.source },
    { key: 'severity', header: 'Severity', render: (r) => r.severity.toUpperCase() },
    { key: 'at', header: 'Quarantined at', render: (r) => formatTs(r.quarantinedAt), sortValue: (r) => r.quarantinedAt },
    { key: 'operator', header: 'Operator', render: (r) => r.operator || '—' },
    policyColumnMonitor,
    {
      key: 'actions',
      header: 'Actions',
      render: (r) =>
        canMutate ? (
          <button
            type="button"
            className="secondary btn-sm"
            disabled={busyId === `monitor:${r.threatKey}`}
            onClick={() => void onRestoreMonitor(r.threatKey, r.id)}
          >
            {busyId === `monitor:${r.threatKey}` ? 'Restoring…' : 'Restore'}
          </button>
        ) : (
          '—'
        ),
    },
  ];

  const empty = !loading && intelRows.length === 0 && monitorRows.length === 0;

  return (
    <section aria-label="Quarantined threats">
      <p className="hint">
        Threat Intel (CVE/OSV) and Threat Monitor (semantic / blocked traffic) entries kept for 30 days.
        Use <strong>View policy</strong> to see the triggered block context and applied YAML rule. Restoring
        intel entries returns catalog visibility only. For monitor entries, restore can keep or remove the
        quarantine-applied policy rule.
      </p>

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

      {loading ? (
        <p className="hint">Loading quarantined threats…</p>
      ) : empty ? (
        <p className="muted">No quarantined entries in the last 30 days.</p>
      ) : (
        <>
          <h4 className="subsection-title">Threat Monitor</h4>
          {monitorRows.length === 0 ? (
            <p className="muted">No quarantined monitor threats.</p>
          ) : (
            <DataTablePro
              columns={monitorColumns}
              rows={monitorRows}
              rowKey={(r) => r.threatKey}
              exportFilename="quarantined-threat-monitor.csv"
            />
          )}
          <h4 className="subsection-title" style={{ marginTop: '1.5rem' }}>
            Threat Intel (CVE / OSV)
          </h4>
          {intelRows.length === 0 ? (
            <p className="muted">No quarantined threat-intel entries.</p>
          ) : (
            <DataTablePro
              columns={intelColumns}
              rows={intelRows}
              rowKey={(r) => r.id}
              exportFilename="quarantined-threat-intel.csv"
            />
          )}
        </>
      )}
    </section>
  );
}

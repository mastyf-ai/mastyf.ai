'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchAdminAuditTrail,
  fetchLogs,
  fetchTenantContext,
  setTenantId,
  getTenantId,
} from '@/lib/mastyf-ai-api';
import { hasPermission } from '@/lib/dashboard-roles';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

type Props = {
  roles?: string[];
  tenantLocked?: boolean;
};

export function AdminPanel({ roles, tenantLocked = false }: Props) {
  const canAdmin = hasPermission(roles, 'admin');
  const [tenantId, setTenantIdLocal] = useState('default');
  const [multiTenant, setMultiTenant] = useState(false);
  const [trail, setTrail] = useState<unknown[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setTenantIdLocal(getTenantId());
    const ctx = await fetchTenantContext();
    if (ctx) {
      setTenantIdLocal(ctx.tenantId);
      setMultiTenant(ctx.multiTenantMode);
    }
    if (canAdmin) {
      setTrail(await fetchAdminAuditTrail());
      setLogs(await fetchLogs());
    }
  }, [canAdmin]);

  useEffect(() => { void refresh(); }, [refresh]);

  const applyTenant = () => {
    setTenantId(tenantId);
    window.location.reload();
  };

  return (
    <div>
      <Card title="Tenant Configuration" subtitle="Manage multi-tenant isolation settings">
        <div className="flex items-center gap-3">
          {tenantLocked ? (
            <span className="text-sm text-secondary">
              Tenant ID: <strong>{tenantId}</strong>
              <span className="text-muted" style={{ marginLeft: 8 }}>(session-bound)</span>
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">Tenant ID:</span>
              <input
                type="text"
                className="input"
                style={{ width: 200 }}
                value={tenantId}
                onChange={(e) => setTenantIdLocal(e.target.value)}
              />
              <Button size="sm" onClick={applyTenant}>Apply & reload</Button>
            </div>
          )}
          {multiTenant && <span className="badge badge-info">Multi-tenant mode</span>}
        </div>
      </Card>

      {canAdmin ? (
        <>
          <Card title="Policy Audit Trail" subtitle="Recent configuration changes">
            {trail.length === 0 ? (
              <p className="text-sm text-muted">No audit trail entries.</p>
            ) : (
              <pre className="mono" style={{ fontSize: 11, background: 'var(--bg-muted)', padding: 12, borderRadius: 6, overflow: 'auto', maxHeight: 300 }}>
                {JSON.stringify(trail.slice(0, 20), null, 2)}
              </pre>
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
        </>
      ) : (
        <Card>
          <p className="text-sm text-muted">Admin role required for audit trail and logs.</p>
        </Card>
      )}
    </div>
  );
}

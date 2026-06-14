'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchAuthStatus,
  fetchTenantContext,
  getTenantId,
  setTenantId,
  type AuthStatus,
} from '@/lib/mastyf-ai-api';
import { Button } from './ui/Button';

type Props = {
  authStatus: AuthStatus | null;
};

export function TenantContextBar({ authStatus }: Props) {
  const [tenantId, setTenantIdLocal] = useState('default');
  const [multiTenant, setMultiTenant] = useState(false);
  const [draft, setDraft] = useState('default');

  const locked =
    !!authStatus?.tenantLocked
    || (!!authStatus?.multiTenantMode && !!authStatus?.sessionTenantId);

  const refresh = useCallback(async () => {
    setTenantIdLocal(getTenantId());
    setDraft(getTenantId());
    const ctx = await fetchTenantContext();
    if (ctx) {
      setTenantIdLocal(ctx.tenantId);
      setDraft(ctx.tenantId);
      setMultiTenant(ctx.multiTenantMode);
    }
    const auth = authStatus ?? (await fetchAuthStatus());
    if (auth?.sessionTenantId && auth.multiTenantMode) {
      setTenantId(auth.sessionTenantId);
      setTenantIdLocal(auth.sessionTenantId);
      setDraft(auth.sessionTenantId);
    }
  }, [authStatus]);

  useEffect(() => { void refresh(); }, [refresh]);

  const applyTenant = () => {
    if (locked) return;
    setTenantId(draft);
    window.location.reload();
  };

  return (
    <div className="flex items-center gap-2" role="status" aria-label="Active tenant">
      <span className="text-xs text-muted">Tenant</span>
      {locked ? (
        <strong className="text-xs font-semibold" style={{ color: 'var(--brand-primary)' }}>{tenantId}</strong>
      ) : (
        <div className="flex items-center gap-1">
          <input
            className="input"
            type="text"
            style={{ width: 120, height: 24, fontSize: 11, padding: '2px 6px' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Tenant ID"
          />
          <Button size="sm" variant="ghost" onClick={applyTenant}>Apply</Button>
        </div>
      )}
      {multiTenant && <span className="badge badge-info">Multi-tenant</span>}
      {locked && <span className="text-xs text-muted">Bound to session</span>}
    </div>
  );
}

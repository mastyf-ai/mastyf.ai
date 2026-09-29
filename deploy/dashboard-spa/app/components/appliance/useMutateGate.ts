'use client';

/**
 * RBAC gate for mutating firewall actions (protect, policy activate, escalate).
 * Empty roles + open-core auth → allow (dev). Explicit viewer → deny mutate.
 */

import { useEffect, useState } from 'react';
import { hasPermission } from '@/lib/dashboard-roles';

export function useMutateGate() {
  const [roles, setRoles] = useState<string[] | undefined>(undefined);
  const [authRequired, setAuthRequired] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/auth/status');
        const data = (await res.json().catch(() => ({}))) as {
          authRequired?: boolean;
          authenticated?: boolean;
          roles?: string[];
          user?: { roles?: string[] };
        };
        if (cancelled) return;
        setAuthRequired(Boolean(data.authRequired));
        setRoles(data.roles || data.user?.roles);
      } catch {
        if (!cancelled) {
          setAuthRequired(false);
          setRoles(undefined);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const canMutate = !authRequired || hasPermission(roles, 'policy_mutate');
  const canExport = !authRequired || hasPermission(roles, 'export');
  const mutateBlockReason =
    authRequired && !canMutate
      ? 'Operator role required (policy_mutate) — view-only'
      : undefined;
  const exportBlockReason =
    authRequired && !canExport ? 'Export permission required — view-only' : undefined;

  return {
    ready,
    roles,
    authRequired,
    canMutate,
    canExport,
    mutateBlockReason,
    exportBlockReason,
  };
}

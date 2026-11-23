'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchProtection, setProtection, type ProtectionStatus } from '@/lib/mastyf-ai-api';

const POLL_MS = 5000;

/** Protection state, kept current while the page is visible so newly added MCP servers appear by themselves. */
export function useProtection() {
  const [status, setStatus] = useState<ProtectionStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** agent/server keys that were not there on the previous read, for the "just found" highlight. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);

  const accept = useCallback((next: ProtectionStatus) => {
    const keys = new Set(next.agents.flatMap((a) => a.servers.map((s) => `${a.id}/${s.name}`)));
    if (known.current) {
      const before = known.current;
      const added = [...keys].filter((k) => !before.has(k));
      if (added.length) setFresh(new Set(added));
    }
    known.current = keys;
    setStatus(next);
    setFailed(false);
  }, []);

  const refresh = useCallback(async () => {
    const next = await fetchProtection().catch(() => null);
    if (next) accept(next);
    else setFailed(true);
  }, [accept]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [refresh]);

  const toggle = useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      setError(null);
      try {
        accept(await setProtection(enabled));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [accept],
  );

  return { status, failed, busy, error, fresh, refresh, toggle };
}

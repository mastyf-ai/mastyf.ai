'use client';

/**
 * Default MCP path honesty — sandbox persist can stop a call before /v1/decide.
 * Never invents latency or “allowed” from an empty sample.
 */

import React, { useEffect, useState } from 'react';

type TierRow = { serverName?: string; tier?: string; source?: string };

export function DefaultPathHonesty() {
  const [tiers, setTiers] = useState<TierRow[] | null>(null);
  const [status, setStatus] = useState<'live' | 'unavailable'>('unavailable');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/industry-standard/sandbox-tiers');
        const json = (await res.json().catch(() => ({}))) as {
          tiers?: TierRow[];
          data?: { tiers?: TierRow[] };
          status?: string;
        };
        if (cancelled) return;
        const list = json.tiers || json.data?.tiers || [];
        if (!res.ok) {
          setTiers([]);
          setStatus('unavailable');
          return;
        }
        setTiers(Array.isArray(list) ? list : []);
        setStatus('live');
      } catch {
        if (!cancelled) {
          setTiers([]);
          setStatus('unavailable');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shadow = (tiers || []).filter((t) => t.tier === 'shadow' || t.tier === 'redact');

  return (
    <section className="mx-cs-panel" data-source={status === 'live' ? 'live-gateway' : 'unavailable'}>
      <div className="mx-section-label-row">
        <span className="mx-section-label">Default MCP path</span>
        <span className="mx-pill neutral">{status === 'live' ? 'LIVE' : 'UNAVAILABLE'}</span>
      </div>
      {status === 'unavailable' ? (
        <p className="mx-empty">Sandbox tier list UNAVAILABLE — not “open allow”.</p>
      ) : shadow.length === 0 ? (
        <p className="text-[11px] text-slate-400 m-0">
          No persisted shadow/redact tiers. A tool call can still hit zero-trust step-up (one request
          per approval). Latency is written only after the call reaches the gateway.
        </p>
      ) : (
        <p className="text-[11px] text-slate-400 m-0">
          Sandbox{' '}
          <span className="mx-mono">
            {shadow
              .slice(0, 4)
              .map((t) => `${t.serverName || 'server'}=${t.tier}`)
              .join(' · ')}
          </span>
          {shadow.length > 4 ? ` · +${shadow.length - 4}` : ''} — these stop before{' '}
          <span className="mx-mono">/v1/decide</span> unless a matching unused allow-once grant
          exists (one tools/call; decide consumes it). Env{' '}
          <span className="mx-mono">MASTYF_AI_DEFAULT_SANDBOX_TIER</span> does not override a saved
          shadow row. Operators who need a one-session override set{' '}
          <span className="mx-mono">MASTYF_AI_SANDBOX_TIER_FORCE</span> (never forever).
        </p>
      )}
    </section>
  );
}

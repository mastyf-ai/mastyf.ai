'use client';

import { useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import type { useProtection } from './useProtection';

type Protection = ReturnType<typeof useProtection>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The protection switch. On, Mastyf finds every local MCP server on this computer and keeps finding new ones. */
export function ProtectionCard({
  protection,
  connection,
  fleetServers,
  onLive,
}: {
  protection: Protection;
  connection: 'live' | 'degraded' | 'offline' | 'connecting';
  /** Servers Fleet Hub is running from mastyf-ai-configs/. */
  fleetServers: string[];
  onLive: () => void;
}) {
  const { status, failed, busy, error, toggle } = protection;
  const [confirming, setConfirming] = useState(false);

  const offline = connection === 'offline' || (failed && !status);
  const servers = status?.agents.flatMap((a) => a.servers.map((s) => ({ ...s, agent: a.name }))) ?? [];
  const mine = servers.filter((s) => s.via === 'mastyf').length;
  const elsewhere = servers.filter((s) => s.via === 'other').length;
  const open = servers.filter((s) => !s.protected && s.transport === 'stdio');
  const checked = mine + fleetServers.length;
  const on = status?.enabled ?? false;

  const tone = offline ? 'off' : on ? 'ok' : 'warn';
  let title = 'Connecting';
  let text = 'Reaching the Mastyf service on this computer.';
  if (offline) {
    title = 'Offline';
    text = 'The Mastyf service on this computer is not answering. Start it with pnpm dashboard:proxy, then refresh.';
  } else if (status && on) {
    title = 'Protection is on';
    text = checked
      ? `Every tool call to ${plural(checked, 'MCP server')} is checked. New servers are picked up by themselves.`
      : 'Watching for MCP servers. Add one to any agent and it is protected by itself, usually within seconds.';
  } else if (status) {
    title = 'Protection is off';
    text = open.length
      ? `${plural(open.length, 'MCP server')} on this computer ${open.length === 1 ? 'is' : 'are'} not checked. Turn protection on to route ${open.length === 1 ? 'it' : 'them'} through Mastyf.`
      : 'Turn it on and Mastyf protects every MCP server it finds on this computer, now and later.';
  }

  const onSwitch = () => {
    if (on) void toggle(false);
    else setConfirming(true);
  };

  return (
    <section className={`sh-card sh-status ${tone}`} aria-labelledby="status-title">
      <span className="sh-status-icon" key={tone} aria-hidden="true">
        {tone === 'ok' ? <ShieldCheck size={26} /> : tone === 'off' ? <ShieldOff size={26} /> : <ShieldAlert size={26} />}
      </span>
      <div className="sh-status-body">
        <h1 id="status-title" className="sh-status-title">{title}</h1>
        <p className="sh-status-text" aria-live="polite">{text}</p>
        {elsewhere > 0 && (
          <p className="sh-status-help">
            {plural(elsewhere, 'more server')} already {elsewhere === 1 ? 'runs' : 'run'} behind another Mastyf on this computer, such as the Shield app, and {elsewhere === 1 ? 'is' : 'are'} left as {elsewhere === 1 ? 'it is' : 'they are'}.
          </p>
        )}
        {fleetServers.length > 0 && <p className="sh-status-help">Started by Fleet Hub: {fleetServers.join(', ')}</p>}
        {error && <p className="agents-result err" role="alert">{error}</p>}
      </div>
      <div className="sh-status-cta">
        {status && !offline && (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Protection"
            className={`prot-switch${on ? ' on' : ''}${busy ? ' busy' : ''}`}
            disabled={busy}
            onClick={onSwitch}
          >
            <span className="prot-knob" />
          </button>
        )}
      </div>

      <div className={`prot-confirm${confirming && !on ? ' open' : ''}`}>
        <div>
          <div className="prot-confirm-inner">
            <p>
              <strong>Turn on protection?</strong>{' '}
              {open.length
                ? `Mastyf edits the MCP settings of ${[...new Set(open.map((s) => s.agent))].join(', ')} so ${open.map((s) => s.name).join(', ')} ${open.length === 1 ? 'starts' : 'start'} through it.`
                : 'There is nothing to change right now. Mastyf edits an agent’s MCP settings when you add a server to it.'}{' '}
              A backup is saved next to each file, and turning protection off puts the settings back. Restart an agent after its
              settings change.
            </p>
            <div className="prot-confirm-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy || !confirming}
                onClick={() => void toggle(true).then(() => setConfirming(false))}
              >
                {busy ? 'Turning on' : 'Turn on'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!confirming} onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        </div>
      </div>

      {on && status && (
        <div className="prot-log">
          {status.events.slice(0, 3).map((e) => (
            <p key={`${e.at}-${e.kind}-${e.agent ?? ''}`} className={`prot-log-row ${e.kind}`}>
              <time>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              <span>
                {e.kind === 'protected' && `Now protecting ${e.servers?.join(', ')} (${status.agents.find((a) => a.id === e.agent)?.name ?? e.agent})`}
                {e.kind === 'on' && 'Protection turned on'}
                {e.kind === 'off' && 'Protection turned off'}
                {e.kind === 'restored' && `Put back: ${e.servers?.join(', ')}`}
                {e.kind === 'failed' && `${e.agent ? `${e.agent}: ` : ''}${e.message}`}
              </span>
            </p>
          ))}
          <button type="button" className="prot-live" onClick={onLive}>See live activity</button>
        </div>
      )}
    </section>
  );
}

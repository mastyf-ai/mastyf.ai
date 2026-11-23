'use client';

import { useMemo, useState } from 'react';
import { Server, ShieldCheck, Wrench } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AuditEvent } from '@/lib/mastyf-ai-api';

/** History timestamps are stored as UTC "YYYY-MM-DD HH:MM:SS". */
export function parseTs(ts: string): Date {
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  return new Date(iso);
}

export function ago(d: Date): string {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function ruleName(rule: string | null): string {
  if (!rule) return 'Policy';
  return rule.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function trimReason(reason: string | null): string {
  if (!reason) return '';
  return reason.replace(/^Blocked by Mastyf AI:\s*/i, '').replace(/\s*\(confidence: [^)]*\)\s*$/i, '');
}

type Ev = AuditEvent & { duration_ms?: number };

/**
 * "Blocked requests": the tools your agents called, Mastyf in the middle, and the servers those
 * calls were meant for, which they never reached. Drawn from your own blocked records.
 */
export function BlockedRequests({ events }: { events: Ev[] }) {
  const blocked = useMemo(() => events.filter((e) => e.action === 'block'), [events]);
  const [selected, setSelected] = useState(0);

  const { tools, servers, rules } = useMemo(() => {
    const count = (key: (e: Ev) => string) => {
      const m = new Map<string, number>();
      for (const e of blocked) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      tools: count((e) => e.tool_name).slice(0, 4),
      servers: count((e) => e.server_name).slice(0, 4),
      rules: count((e) => e.rule || 'policy'),
    };
  }, [blocked]);

  if (blocked.length === 0) {
    return (
      <section className="sh-card" aria-labelledby="blocked-title">
        <div className="sh-card-head">
          <h2 id="blocked-title" className="sh-h2">Blocked requests</h2>
        </div>
        <p className="muted">Nothing has been blocked in the last 90 days. When an agent tries something your policy forbids, it shows up here.</p>
      </section>
    );
  }

  const W = 640;
  const H = 340;
  const cx = W / 2;
  const cy = H / 2;
  const rowY = (i: number, n: number) => (n === 1 ? cy : 60 + (i * (H - 120)) / (n - 1));
  const featured = blocked[Math.min(selected, blocked.length - 1)];

  return (
    <section className="sh-card" aria-labelledby="blocked-title">
      <div className="sh-card-head">
        <h2 id="blocked-title" className="sh-h2">
          Blocked requests <span className="sh-h2-note">last 90 days</span>
        </h2>
        <span className="sh-legend">
          <i className="dot red" /> Blocked call <i className="dot gold" /> Mastyf <i className="dot green" /> Never reached
        </span>
      </div>
      <div className="br-grid">
        <div className="br-flow">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${blocked.length} blocked calls from ${tools.length} tools, stopped before ${servers.length} servers`}>
            <circle cx={cx} cy={cy} r={150} className="br-ring" />
            <circle cx={cx} cy={cy} r={95} className="br-ring" />
            {tools.map(([name], i) => {
              const y = rowY(i, tools.length);
              return <path key={`l-${name}`} d={`M 110 ${y} C 200 ${y}, 220 ${cy}, ${cx - 34} ${cy}`} className="br-edge-in" />;
            })}
            {servers.map(([name], i) => {
              const y = rowY(i, servers.length);
              return (
                <g key={`r-${name}`}>
                  <path d={`M ${cx + 34} ${cy} C ${cx + 120} ${cy}, ${W - 220} ${y}, ${W - 112} ${y}`} className="br-edge-out" />
                  <g transform={`translate(${cx + 58}, ${cy + (y - cy) * 0.12})`} className="br-x">
                    <circle r={8} />
                    <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" />
                  </g>
                </g>
              );
            })}
            {tools.map(([name, n], i) => {
              const y = rowY(i, tools.length);
              return (
                <g key={`ln-${name}`} transform={`translate(84, ${y})`}>
                  <circle r={24} className="br-node red" />
                  <foreignObject x={-9} y={-9} width={18} height={18}><Wrench size={18} className="br-ic red" /></foreignObject>
                  <text y={42} className="br-label">{name.length > 16 ? `${name.slice(0, 15)}…` : name}</text>
                  <text y={57} className="br-sub">blocked {n}×</text>
                </g>
              );
            })}
            <g transform={`translate(${cx}, ${cy})`}>
              <circle r={34} className="br-node gold" />
              <foreignObject x={-11} y={-11} width={22} height={22}><ShieldCheck size={22} className="br-ic gold" /></foreignObject>
              <text y={54} className="br-label">Mastyf</text>
              <text y={69} className="br-sub">stopped here</text>
            </g>
            {servers.map(([name], i) => {
              const y = rowY(i, servers.length);
              return (
                <g key={`rn-${name}`} transform={`translate(${W - 84}, ${y})`}>
                  <circle r={24} className="br-node green" />
                  <foreignObject x={-9} y={-9} width={18} height={18}><Server size={18} className="br-ic green" /></foreignObject>
                  <text y={42} className="br-label">{name.length > 16 ? `${name.slice(0, 15)}…` : name}</text>
                  <text y={57} className="br-sub">never reached</text>
                </g>
              );
            })}
          </svg>
          <p className="br-rules">
            {rules.slice(0, 4).map(([r, n]) => (
              <span key={r} className="pill red">{ruleName(r)} ×{n}</span>
            ))}
          </p>
        </div>

        <div className="br-side">
          <div className="br-feature">
            <h3>{ruleName(featured.rule)}</h3>
            <p>
              An agent tried to call <strong>{featured.tool_name}</strong> on <strong>{featured.server_name}</strong>.{' '}
              {trimReason(featured.reason)} Stopped before it reached the server.
            </p>
            <span className="muted">{ago(parseTs(featured.timestamp))}</span>
          </div>
          <ul className="br-list">
            {blocked.slice(0, 6).map((e, i) => (
              <li key={`${e.timestamp}-${i}`}>
                <button type="button" className={i === selected ? 'active' : ''} onClick={() => setSelected(i)}>
                  <span className="br-tool">{e.tool_name}</span>
                  <span className="pill red">{ruleName(e.rule)}</span>
                  <span className="br-where">on {e.server_name}</span>
                  <span className="br-when">{ago(parseTs(e.timestamp))}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Allowed and blocked calls per day over the last seven days. */
export function ThisWeek({ events }: { events: Ev[] }) {
  const data = useMemo(() => {
    const days: { key: string; label: string; allowed: number; blocked: number }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      days.push({ key: d.toDateString(), label: d.toLocaleDateString([], { weekday: 'short' }), allowed: 0, blocked: 0 });
    }
    for (const e of events) {
      const k = parseTs(e.timestamp).toDateString();
      const day = days.find((x) => x.key === k);
      if (!day) continue;
      if (e.action === 'block') day.blocked += 1;
      else day.allowed += 1;
    }
    return days;
  }, [events]);
  const total = data.reduce((n, d) => n + d.allowed + d.blocked, 0);

  return (
    <section className="sh-card" aria-labelledby="week-title">
      <div className="sh-card-head">
        <h2 id="week-title" className="sh-h2">This week</h2>
        <span className="sh-legend"><i className="dot green" /> Allowed <i className="dot red" /> Blocked</span>
      </div>
      {total === 0 ? (
        <p className="muted">No tool calls in the last seven days.</p>
      ) : (
        <div className="wk-chart">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--chart-axis)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} stroke="var(--chart-axis)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--border-strong)', borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: 'var(--text)' }}
              />
              <Area type="monotone" dataKey="blocked" name="Blocked" stroke="var(--chart-block)" fill="var(--danger-subtle)" strokeWidth={2} />
              <Area type="monotone" dataKey="allowed" name="Allowed" stroke="var(--chart-allow)" fill="var(--success-subtle)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

/** The latest decisions, newest first. */
export function RecentRequests({ events, live, onSeeAll }: { events: Ev[]; live: boolean; onSeeAll: () => void }) {
  return (
    <section className="sh-card" aria-labelledby="recent-title">
      <div className="sh-card-head">
        <h2 id="recent-title" className="sh-h2">Recent requests</h2>
        <span className={live ? 'live-text' : 'muted'}>{live ? 'Live' : 'Not live'}</span>
      </div>
      {events.length === 0 ? (
        <p className="muted">No requests yet. They appear here as soon as an agent uses a server that goes through Mastyf.</p>
      ) : (
        <ul className="rr-list">
          {events.slice(0, 7).map((e, i) => {
            const d = parseTs(e.timestamp);
            return (
              <li key={`${e.timestamp}-${i}`}>
                <div>
                  <span className="rr-tool">{e.tool_name}</span>
                  <span className="rr-meta">
                    {e.server_name}, {d.toLocaleDateString([], { day: 'numeric', month: 'short' })} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    {typeof e.duration_ms === 'number' ? `, ${e.duration_ms} ms` : ''}
                  </span>
                </div>
                <span className={`pill ${e.action === 'block' ? 'red' : 'green'}`}>{e.action === 'block' ? 'Blocked' : 'Allowed'}</span>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="link-btn" onClick={onSeeAll}>See all activity</button>
    </section>
  );
}

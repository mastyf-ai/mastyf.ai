'use client';

import { useMemo, useState } from 'react';
import { AUTHORITY_DATA } from '@/lib/authority/data';

const OUTCOMES = ['BLOCKED', 'CAPPED', 'DELAYED', 'DETECTED', 'NOT COVERED'] as const;
const LABEL: Record<string, string> = { BLOCKED: 'Blocked', CAPPED: 'Capped', DELAYED: 'Held', DETECTED: 'Detected', 'NOT COVERED': 'Not covered' };

export function AttackMatrix() {
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const rows = AUTHORITY_DATA.attack;
  const counts = useMemo(() => Object.fromEntries(OUTCOMES.map((o) => [o, rows.filter((r) => r.outcome === o).length])), [rows]);
  const tactics = useMemo(() => Array.from(new Set(rows.map((r) => r.tactic))), [rows]);
  const shown = filter ? rows.filter((r) => r.outcome === filter) : rows;
  const sel = rows.find((r) => r.technique === open);
  return (
    <div className="auth-matrix">
      <div className="auth-legend" role="group" aria-label="Filter by outcome">
        {OUTCOMES.map((o) => (
          <button key={o} type="button" aria-pressed={filter === o} onClick={() => setFilter(filter === o ? null : o)}
                  className={`auth-legend__item auth-o--${o.replace(' ', '-').toLowerCase()}`}>
            <span className="auth-legend__swatch" aria-hidden="true" /> {LABEL[o]} <strong>{counts[o]}</strong>
          </button>
        ))}
      </div>
      <div className="auth-matrix__grid">
        {tactics.map((t) => {
          const items = shown.filter((r) => r.tactic === t);
          if (!items.length) return null;
          return (
            <div key={t} className="auth-matrix__col">
              <p className="auth-matrix__tactic">{t}</p>
              {items.map((r) => (
                <button key={r.technique} type="button" onClick={() => setOpen(open === r.technique ? null : r.technique)}
                        aria-expanded={open === r.technique}
                        className={`auth-tile auth-o--${r.outcome.replace(' ', '-').toLowerCase()}`}>
                  <span className="auth-tile__id">{r.technique}</span>
                  <span className="auth-tile__name">{r.name}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {sel ? (
        <div className="auth-matrix__detail" aria-live="polite">
          <p><strong>{sel.technique} · {sel.name}</strong> — {LABEL[sel.outcome]}</p>
          <p>{sel.note}</p>
        </div>
      ) : (
        <p className="auth-footnote">Select a technique for details. Run against the real components, including with the decision engine assumed hacked.</p>
      )}
    </div>
  );
}

export function AgentBench() {
  const a = AUTHORITY_DATA.agent;
  const bars = [
    { label: 'No controls (agent hijacked every time)', v: 100, cls: 'bad' },
    { label: 'Loose approval (no named recipients) — now refused', v: a.loose.attack_success_pct, cls: 'warn' },
    { label: 'Exact task approved', v: a.exact.attack_success_pct, cls: 'ok' },
    { label: 'Exact task + untrusted inputs tracked', v: a.tracked.attack_success_pct, cls: 'ok' },
  ];
  return (
    <div className="auth-agent">
      <p className="auth-agent__lead">
        AgentDojo v1.2: {a.pairs} pairs of an ordinary task and a hidden attack, in e-mail, travel, banking and Slack.
        We assume the agent is <strong>hijacked on every single one</strong>, and measure what the limits still stop.
      </p>
      <ul className="auth-hbars">
        {bars.map((b) => (
          <li key={b.label}>
            <span className="auth-hbars__label">{b.label}</span>
            <span className={`auth-hbars__bar auth-hbars__bar--${b.cls}`}><span style={{ width: `${Math.max(b.v, 0.6)}%` }} /></span>
            <span className="auth-num">{b.v}%</span>
          </li>
        ))}
      </ul>
      <p className="auth-footnote">
        Attack success = the attacker’s actions all went through without the person confirming. Ordinary work:{' '}
        {a.utility.completed_without_confirmation} of {a.utility.user_tasks} tasks completed without a single confirmation.
        Caveat: task approvals come from the benchmark’s reference plans.
      </p>
    </div>
  );
}

export function DetectionChart() {
  const d = AUTHORITY_DATA.detection.filter((r) => r.of > 1);
  return (
    <div className="auth-detect">
      <ul className="auth-detect__rows">
        {d.map((r) => (
          <li key={r.release}>
            <span className="auth-detect__name">CERT {r.release}</span>
            <span className="auth-detect__track">
              <span className="auth-detect__after" style={{ width: `${(r.after / r.of) * 100}%` }} />
              <span className="auth-detect__before" style={{ width: `${(r.before / r.of) * 100}%` }} />
            </span>
            <span className="auth-num">{r.after} / {r.of}</span>
          </li>
        ))}
      </ul>
      <p className="auth-footnote">
        <span className="auth-key auth-key--after" /> new behaviour model <span className="auth-key auth-key--before" /> previous model ·
        insiders flagged at 5 alerts a day on Carnegie Mellon’s CERT insider-threat datasets, without any attack examples.
        Quiet insiders in the newest releases are still mostly missed; budgets cap what they can take.
      </p>
    </div>
  );
}

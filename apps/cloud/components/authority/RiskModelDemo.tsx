'use client';

import { useMemo, useState } from 'react';
import { Activity, Check, Plus } from 'lucide-react';

/**
 * The behavioural risk model, explained by doing: build Alice's day and watch the score.
 * The scoring shown is an illustration of how the model reasons (new for this person, rare in the
 * company, unusual volume or hour, small oddities adding up); the measured results are below it.
 */

type Act = { id: string; label: string; detail: string; weight: number; tags: string[] };

const ACTS: Act[] = [
  { id: 'calls', label: 'Opens records for 35 incoming calls', detail: 'What she does every day', weight: 0, tags: ['Normal'] },
  { id: 'report', label: 'Sends the weekly report to the reports bucket', detail: 'Done every Friday', weight: 0.2, tags: ['Normal'] },
  { id: 'more', label: 'Opens 30% more records than usual', detail: 'A busy day', weight: 0.6, tags: ['A bit more than usual'] },
  { id: 'night', label: 'Signs in at 3 am', detail: 'She never works nights', weight: 1.4, tags: ['Unusual hour', 'New for Alice'] },
  { id: 'export', label: 'Exports customers to a file-sharing site', detail: 'Nobody in support does this', weight: 3.4, tags: ['New for Alice', 'Rare in the company'] },
  { id: 'bulk', label: 'Pulls 10× her usual number of records', detail: 'Far above any day she has had', weight: 2.4, tags: ['Unusual volume'] },
  { id: 'secrets', label: 'Reads production passwords', detail: '2 of 40 people ever do this', weight: 3.1, tags: ['New for Alice', 'Rare in the company'] },
];

const SCALE = 1.2; // score where today's risk reaches 0.5 (illustrative)
const risk = (s: number) => (s <= 0 ? 0 : s / (s + SCALE));
const SLOW_SCALE = 4;
const slowRisk = (s: number) => (s <= 0 ? 0 : s / (s + SLOW_SCALE));
const zone = (r: number) => (r >= 0.9 ? 'deny' : r >= 0.5 ? 'ask' : 'allow');
const ZONE_LABEL = { allow: 'Goes ahead', ask: 'A second person must approve', deny: 'Refused' } as const;

// Slow insider: one slightly odd thing most days. Each day alone stays low; together they add up.
const DAILY = [0.4, 0.2, 0.9, 0, 1.1, 0.8, 0.3, 1.2, 0.9, 1.4, 0.6, 1.3, 1.0, 1.5];
const DECAY = 0.85;
const ALLOW = 0.5;

export function RiskModelDemo() {
  const [picked, setPicked] = useState<string[]>(['calls', 'report']);
  const [slow, setSlow] = useState(true);
  const chosen = ACTS.filter((a) => picked.includes(a.id));
  const s = chosen.reduce((t, a) => t + a.weight, 0);
  const r = risk(s);
  const z = zone(r);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const series = useMemo(() => {
    let acc = 0;
    return DAILY.map((d) => {
      acc = Math.max(0, acc * DECAY + d - ALLOW);
      return { day: slowRisk(d), built: slowRisk(acc * 2.2) };
    });
  }, []);
  const flaggedDay = series.findIndex((x) => x.built >= 0.5);

  return (
    <div className="rm">
      <div className="rm__grid">
        <div className="rm__profile">
          <p className="rm__kicker"><Activity size={13} strokeWidth={1.75} aria-hidden="true" /> What the model has learned about Alice</p>
          <ul className="rm__facts">
            <li><strong>Role</strong> Support agent, 6 weeks of history</li>
            <li><strong>Hours</strong> 9 am – 6 pm, weekdays</li>
            <li><strong>Usual volume</strong> 30–60 customer records a day</li>
            <li><strong>Destinations</strong> The reports bucket only</li>
            <li><strong>Never</strong> Exports, passwords, night work</li>
          </ul>
          <p className="rm__note">It learns this for every person and service on its own. No attack examples needed.</p>
        </div>

        <div className="rm__acts">
          <p className="rm__kicker">Build Alice’s day: add or remove what happens</p>
          <ul>
            {ACTS.map((a) => {
              const on = picked.includes(a.id);
              return (
                <li key={a.id}>
                  <button type="button" aria-pressed={on} onClick={() => toggle(a.id)} className="rm__act">
                    <span className="rm__check" aria-hidden="true">{on ? <Check size={13} strokeWidth={2.2} /> : <Plus size={13} strokeWidth={2} />}</span>
                    <span className="rm__act-text">
                      <span>{a.label}</span>
                      <small>{a.detail}</small>
                    </span>
                    <span className="rm__tags">
                      {a.tags.map((t) => <span key={t} className={`rm__tag${t === 'Normal' ? ' rm__tag--ok' : ''}`}>{t}</span>)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={`rm__score rm__score--${z}`} aria-live="polite">
          <p className="rm__kicker">Risk for today</p>
          <div className="rm__dial" style={{ ['--r' as string]: r }}>
            <svg viewBox="0 0 120 70" aria-hidden="true">
              <path d="M10 62 A50 50 0 0 1 110 62" className="rm__arc-bg" />
              <path d="M10 62 A50 50 0 0 1 110 62" className="rm__arc" pathLength={100} style={{ strokeDasharray: `${r * 100} 100` }} />
              <line x1="60" y1="12" x2="60" y2="20" className="rm__tick" />
              <line x1="104" y1="38" x2="97" y2="42" className="rm__tick" />
            </svg>
            <span className="rm__value">{r.toFixed(2)}</span>
          </div>
          <p className="rm__zone">{ZONE_LABEL[z]}</p>
          <ul className="rm__why">
            {chosen.filter((a) => a.weight > 0.5).map((a) => (
              <li key={a.id}>{a.label.replace(/^\w/, (c) => c.toLowerCase())}: {a.tags.filter((t) => t !== 'Normal').join(', ').toLowerCase()}</li>
            ))}
            {chosen.every((a) => a.weight <= 0.5) ? <li>Everything looks like Alice’s normal work.</li> : null}
          </ul>
          <p className="rm__rule">The model can only make a decision stricter. Even at 0.00, Alice’s data budget still applies.</p>
        </div>
      </div>

      <div className="rm__slow">
        <div className="rm__slow-head">
          <div>
            <p className="rm__kicker">Quiet insiders: small oddities add up</p>
            <p className="rm__slow-lead">A careful insider does one slightly unusual thing a day. No single day looks bad.</p>
          </div>
          <label className="auth-toggle">
            <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} />
            <span>Add up over days</span>
          </label>
        </div>
        <div className="rm__chart" role="img" aria-label={slow ? `Flagged on day ${flaggedDay + 1}` : 'Never flagged when each day is judged alone'}>
          <span className="rm__line" style={{ bottom: '50%' }}><span>approval needed</span></span>
          {series.map((x, i) => {
            const v = slow ? x.built : x.day;
            const hit = slow && i >= flaggedDay && flaggedDay >= 0;
            return (
              <span key={i} className="rm__col">
                <span className={`rm__bar${hit ? ' is-hit' : ''}`} style={{ height: `${Math.max(v * 100, 2)}%`, transitionDelay: `${i * 30}ms` }} />
                <span className="rm__day">{i + 1}</span>
              </span>
            );
          })}
        </div>
        <p className="auth-footnote">
          {slow
            ? `Judged together, the pattern needs a second person’s approval on day ${flaggedDay + 1}.`
            : 'Judged one day at a time, nothing is ever flagged.'}{' '}
          Illustration of how the model reasons; measured results are in the benchmarks below.
        </p>
      </div>

      <dl className="rm__results">
        <div><dt>Real insiders flagged</dt><dd><strong>179 of 187</strong> CERT insiders at 5 alerts a day, no attack examples; 9 of 11 on releases held back for testing</dd></div>
        <div><dt>Hackers moving between machines</dt><dd><strong>23 of 50</strong> compromised accounts flagged on LANL’s real red-team data (was 10)</dd></div>
        <div><dt>Extra approvals</dt><dd><strong>&lt; 1 a day</strong> across a simulated company of 9 people and services</dd></div>
        <div><dt>Speed</dt><dd><strong>0.07 ms</strong> per decision</dd></div>
      </dl>
    </div>
  );
}

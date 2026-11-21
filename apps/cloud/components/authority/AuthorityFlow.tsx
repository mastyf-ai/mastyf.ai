'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Clock, KeyRound, ShieldCheck, ShieldX, X } from 'lucide-react';
import { PlayToggle, useGatePass, useReducedMotion } from '@/app/attack-lab/GateSim';

/**
 * The opening explainer for Authority, in the same console as the homepage's Protocol X demo:
 * a request arrives, Authority runs its checks one by one, a budget meter shows what is left,
 * and the outcome lands. Five cases cycle until the visitor picks one. Outcomes are the measured
 * results from the attack scorecard; the visual is a simulation of them.
 */

type CheckState = 'ok' | 'fail' | 'hold' | 'na';
type Case = {
  id: string;
  label: string;
  tone: 'allow' | 'block' | 'hold';
  who: string;
  to: string;
  request: string;
  checks: { name: string; state: CheckState; note: string }[];
  meter?: { label: string; used: number; add: number; limit: number };
  timer?: { label: string; hours: number };
  verdict: string;
  outcome: string;
};

const CASES: Case[] = [
  {
    id: 'normal', label: 'Normal work', tone: 'allow', who: 'Support agent', to: 'Data',
    request: 'alice @ her laptop\nread customers × 40\nreason: ticket 4812',
    checks: [
      { name: 'Device', state: 'ok', note: 'Alice’s registered laptop, fingerprint' },
      { name: 'Need-to-know', state: 'ok', note: 'On her cases and today’s calls' },
      { name: 'Budget', state: 'ok', note: '1,240 + 40 of 5,000 today' },
    ],
    meter: { label: 'Alice · customer records today', used: 1240, add: 40, limit: 5000 },
    verdict: 'Allowed', outcome: '40 record keys released, only to Alice’s laptop. Each copy is marked to her.',
  },
  {
    id: 'password', label: 'Stolen password', tone: 'block', who: 'Attacker', to: 'Data',
    request: 'alice (password, cookie)\nfrom an unknown machine\nread customers × 5,000',
    checks: [
      { name: 'Device', state: 'fail', note: 'No registered device: no keys' },
      { name: 'Need-to-know', state: 'na', note: 'Not reached' },
      { name: 'Budget', state: 'na', note: 'Not reached' },
    ],
    verdict: 'Blocked', outcome: 'Nothing released. A password, cookie or token alone opens no record.',
  },
  {
    id: 'malware', label: 'Malware on the laptop', tone: 'block', who: 'Alice’s laptop', to: 'Data',
    request: 'alice @ her laptop\nread customers × 2,000\n4th large pull today',
    checks: [
      { name: 'Device', state: 'ok', note: 'Real device: the malware has it' },
      { name: 'Need-to-know', state: 'ok', note: 'Within her outside-case allowance' },
      { name: 'Budget', state: 'fail', note: '4,200 + 2,000 > 5,000 today' },
    ],
    meter: { label: 'Alice · customer records today', used: 4200, add: 2000, limit: 5000 },
    verdict: 'Capped', outcome: 'Refused. The most this laptop can ever take is 5,000 records a day, even if everything in front of the vault is hacked.',
  },
  {
    id: 'ransom', label: 'Ransomware', tone: 'hold', who: 'Backup service', to: 'Storage',
    request: 'svc:backup\ndelete 12 prod buckets\nwithin 10 minutes',
    checks: [
      { name: 'Identity', state: 'ok', note: 'The real backup service key' },
      { name: 'Undo window', state: 'hold', note: 'Deletions wait 24 h, anyone can cancel' },
      { name: 'Burst', state: 'fail', note: '6th in an hour: account frozen' },
    ],
    timer: { label: 'Executes in', hours: 24 },
    verdict: 'Held', outcome: '0 of 12 deletions ran. The burst froze the account and cancelled its whole queue.',
  },
  {
    id: 'agent', label: 'Hijacked AI agent', tone: 'block', who: 'AI support agent', to: 'Outside',
    request: 'agent:support-bot\nexport customers × 50,000\nto attacker.example',
    checks: [
      { name: 'Approved task', state: 'fail', note: 'Alice approved: read 20 records for one ticket' },
      { name: 'Recipient', state: 'fail', note: 'Not a recipient she named' },
      { name: 'Session cap', state: 'na', note: 'Not reached' },
    ],
    verdict: 'Blocked', outcome: 'Refused as outside the task. Three such tries end the session and alert Alice.',
  },
];

const STEPS = [
  { t: 'Asks', d: 'A person, service or AI agent asks for data or for something that cannot be undone.' },
  { t: 'Authority checks', d: 'Device, task, budget and undo window, each enforced where the data and actions live.' },
  { t: 'Outcome', d: 'Keys within budget, an action held so it can be cancelled, or nothing at all.' },
];

function useInView<T extends Element>(threshold: number) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

const fmt = (n: number) => n.toLocaleString('en-US');

export function AuthorityFlow() {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(0.25);
  const [idx, setIdx] = useState(0);
  const [pass, setPass] = useState(0);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const c = CASES[idx];
  const { phase, typed } = useGatePass(inView && !reduced && !paused, c.request.length, 3400, `${idx}-${pass}`, () => {
    if (held) setPass((p) => p + 1);
    else setIdx((i) => (i + 1) % CASES.length);
  });

  // checks light up one by one while Authority reads the request
  const [lit, setLit] = useState(c.checks.length);
  useEffect(() => {
    if (phase !== 'scan') {
      setLit(phase === 'verdict' || phase === 'rest' ? c.checks.length : 0);
      return;
    }
    setLit(0);
    const ts = c.checks.map((_, i) => window.setTimeout(() => setLit(i + 1), 300 + i * 330));
    return () => ts.forEach((t) => window.clearTimeout(t));
  }, [phase, c]);

  const decided = phase === 'verdict' || phase === 'rest';
  const reading = phase === 'scan';
  const step = phase === 'ready' ? -1 : phase === 'type' ? 0 : decided ? 2 : 1;
  const tone = decided ? (c.tone === 'allow' ? 'allow' : c.tone === 'hold' ? 'hold' : 'block') : reading ? 'read' : 'idle';
  const blocked = decided && c.tone !== 'allow';

  const pick = (i: number) => {
    setHeld(true);
    setPaused(false);
    setIdx(i);
    setPass((p) => p + 1);
  };

  const m = c.meter;
  const showAdd = m && (reading || decided);
  const over = m ? m.used + m.add > m.limit : false;

  return (
    <div ref={ref} className="alab-sim">
      <div className={`console alab-gate alab-gate--hero alab-gate--${tone === 'hold' ? 'read' : tone} authf authf--${tone}`}>
        <div className="console__head alab-hero-head">
          <span className="console__id">
            <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" />
            mastyf
            <span className="dim">· authority</span>
          </span>
          <div className="alab-pills" role="group" aria-label="Pick a case">
            {CASES.map((item, i) => (
              <button key={item.id} type="button" aria-pressed={i === idx} onClick={() => pick(i)}
                      className={`alab-pill alab-pill--${item.tone === 'allow' ? 'allow' : 'block'}`}>
                <span className="alab-pill__mark" aria-hidden="true">{item.tone === 'allow' ? '●' : item.tone === 'hold' ? '◷' : '×'}</span>
                {item.label}
              </button>
            ))}
          </div>
          {reduced ? null : <PlayToggle paused={paused} onToggle={() => setPaused((v) => !v)} />}
        </div>

        <ol className="alab-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.t} className={i === step ? 'is-on' : i < step ? 'is-done' : undefined}>
              <span className="alab-steps__n" aria-hidden="true">{i + 1}</span>
              <span className="alab-steps__t">{s.t}</span>
              <span className="alab-steps__d">{s.d}</span>
            </li>
          ))}
        </ol>

        <div className={`path alab-path${decided ? (blocked ? ' path--block' : ' path--allow') : ''}`} aria-hidden="true">
          <span className="path__node">{c.who}</span>
          <span className="path__seg">
            {phase === 'transit' || phase === 'scan' || phase === 'verdict' ? <span key={`in-${idx}-${pass}`} className="path__packet" /> : null}
          </span>
          <span className={`path__node path__node--gate${phase === 'verdict' && blocked ? ' is-tripped' : ''}${reading ? ' is-reading' : ''}`}>
            {decided && blocked ? <ShieldX size={13} strokeWidth={1.75} /> : <ShieldCheck size={13} strokeWidth={1.75} />}
            Authority
          </span>
          <span className="path__seg path__seg--out">
            {phase === 'verdict' && !blocked ? <span key={`out-${idx}-${pass}`} className="path__packet path__packet--late" /> : null}
          </span>
          <span className="path__node">{c.to}</span>
        </div>

        <div className="authf__body">
          <div className="alab-payload-wrap authf__req">
            <span className="alab-dir">Request</span>
            <pre className="intercept__payload alab-payload">
              <span className="sr-only">{c.request}</span>
              <span className="alab-payload__ghost" aria-hidden="true">{c.request}</span>
              <span className="alab-payload__live" aria-hidden="true">
                {c.request.slice(0, typed)}
                {phase === 'type' ? <span className="alab-caret" /> : null}
              </span>
            </pre>
          </div>
          <ul className="authf__checks" aria-label="Authority's checks">
            {c.checks.map((k, i) => {
              const on = i < lit;
              return (
                <li key={k.name} className={`authf__check authf__check--${on ? k.state : 'wait'}`}>
                  <span className="authf__icon" aria-hidden="true">
                    {!on ? <span className="authf__dot" /> : k.state === 'ok' ? <Check size={13} strokeWidth={2.2} />
                      : k.state === 'fail' ? <X size={13} strokeWidth={2.2} /> : k.state === 'hold' ? <Clock size={13} strokeWidth={2} /> : <span className="authf__dash" />}
                  </span>
                  <span className="authf__name">{k.name}</span>
                  <span className="authf__note">{on ? k.note : '…'}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {m ? (
          <div className={`alab-gauge authf__meter${showAdd && over ? ' authf__meter--over' : ''}`}>
            <span className="alab-gauge__label"><KeyRound size={12} strokeWidth={1.75} aria-hidden="true" /> {m.label}</span>
            <span className="authf__track" aria-hidden="true">
              <span className="authf__used" style={{ width: `${(m.used / m.limit) * 100}%` }} />
              <span className={`authf__add${over ? ' is-over' : ''}`}
                    style={{ left: `${(m.used / m.limit) * 100}%`, width: showAdd ? `${(Math.min(m.add, m.limit * 1.2 - m.used) / m.limit) * 100}%` : '0%' }} />
              <span className="authf__limit" />
            </span>
            <span className="alab-gauge__val">{showAdd ? fmt(m.used + m.add) : fmt(m.used)} / {fmt(m.limit)}</span>
          </div>
        ) : c.timer ? (
          <div className="alab-gauge authf__meter authf__meter--timer">
            <span className="alab-gauge__label"><Clock size={12} strokeWidth={1.75} aria-hidden="true" /> {c.timer.label}</span>
            <span className="authf__track" aria-hidden="true">
              <span className={`authf__clock${decided ? ' is-running' : ''}`} key={`t-${idx}-${pass}`} />
            </span>
            <span className="alab-gauge__val">{decided ? `${c.timer.hours} h` : '—'}</span>
          </div>
        ) : (
          <div className="alab-gauge authf__meter">
            <span className="alab-gauge__label"><KeyRound size={12} strokeWidth={1.75} aria-hidden="true" /> Record keys released</span>
            <span className="authf__track" aria-hidden="true" />
            <span className="alab-gauge__val">{decided ? '0' : '—'}</span>
          </div>
        )}

        <div className={`verdict${decided ? (c.tone === 'allow' ? ' verdict--allow' : c.tone === 'hold' ? ' authf__verdict--hold' : ' verdict--block') : ' alab-verdict--pending'}`}>
          <span className={`status ${decided ? (c.tone === 'allow' ? 'status--allow' : c.tone === 'hold' ? 'status--evaluating' : 'status--block') : reading ? 'status--evaluating' : 'status--idle'}`}>
            <span className="status__mark" aria-hidden="true">{decided ? (c.tone === 'allow' ? '●' : c.tone === 'hold' ? '◷' : '×') : '●'}</span>
            {decided ? c.verdict : reading ? 'Checking' : phase === 'ready' ? 'Ready' : 'Arriving'}
          </span>
          <span className="verdict__bytes">{decided ? c.outcome : 'Authority is checking the request…'}</span>
        </div>

        <div className="console__foot">
          <span>Outcomes are measured results from attacking the real system; the animation shows them.</span>
          <span className="alab-hint">{held ? 'Holding your pick.' : 'Cycling through five cases; pick one to hold it.'}</span>
        </div>
      </div>
    </div>
  );
}

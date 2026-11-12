'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play, ShieldCheck, ShieldX } from 'lucide-react';
import { BENIGN_CHECK, HOW_SCENARIOS, type AttackEntry, type Direction } from './data';

/**
 * Replays a recorded Protocol X decision: the payload types in, travels to the gate, the model
 * reads it (probability counts up), and the verdict lands. Built on the site's console / path /
 * verdict classes so it matches the other demos. At rest (no JS, reduced motion, paused, or off
 * screen) it shows the finished decision, so the page reads completely without animation.
 */

/** `ready` is a payload waiting to be sent: no verdict yet. */
export type Phase = 'ready' | 'rest' | 'type' | 'transit' | 'scan' | 'verdict';

export type Sim = {
  direction: Direction;
  tool: string;
  payload: string;
  trigger?: string;
  verdict: 'ALLOWED' | 'BLOCKED';
  pUnsafe: number;
  latencyMs: number;
  outcome: string;
  /** A wrong verdict (an attack that got through, or harmless text blocked): shown in the danger colour. */
  bad?: boolean;
  /** The verdict word, when Blocked or Allowed would mislead. */
  label?: string;
};

const STEPS = [
  { t: 'Arrives', d: 'Every tool call and every tool result passes through Mastyf first.' },
  { t: 'Protocol X reads it', d: 'One forward pass of the decision model returns a probability and a verdict.' },
  { t: 'Verdict', d: 'Allowed calls run. Blocked ones never reach their target. When unsure, it blocks.' },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

function useInView<T extends Element>(threshold: number) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/** One animated pass per `passKey`; calls `onDone` after the verdict has been held for `holdMs`. */
export function useGatePass(active: boolean, length: number, holdMs: number, passKey: string, onDone: () => void) {
  const [phase, setPhase] = useState<Phase>('rest');
  const [typed, setTyped] = useState(length);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (!active) {
      setPhase('rest');
      setTyped(length);
      return;
    }
    let cancelled = false;
    let raf = 0;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) =>
      timers.push(window.setTimeout(() => !cancelled && fn(), ms));
    const typeMs = clamp(length * 9, 700, 1500);

    setPhase('type');
    setTyped(0);
    const start = performance.now();
    const tick = (now: number) => {
      if (cancelled) return;
      const f = Math.min(1, (now - start) / typeMs);
      setTyped(Math.round(f * length));
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    at(typeMs, () => setPhase('transit'));
    at(typeMs + 650, () => setPhase('scan'));
    at(typeMs + 1850, () => setPhase('verdict'));
    at(typeMs + 1850 + holdMs, () => done.current());

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(raf);
    };
  }, [active, length, holdMs, passKey]);

  return { phase, typed };
}

/** Eases from 0 to `target` while `running`; holds `target` otherwise. */
function useCountUp(target: number, running: boolean, ms: number) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (!running) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const f = Math.min(1, (now - start) / ms);
      setValue(target * (1 - Math.pow(1 - f, 3)));
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    setValue(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, running, ms]);
  return value;
}

function Payload({ s, typed, phase }: { s: Sim; typed: number; phase: Phase }) {
  const full = s.payload;
  const decided = phase === 'verdict' || phase === 'rest';
  let live: ReactNode = full.slice(0, typed);
  if (decided && s.verdict === 'BLOCKED' && s.trigger) {
    const i = full.indexOf(s.trigger);
    if (i >= 0) {
      live = (
        <>
          {full.slice(0, i)}
          <mark>{full.slice(i, i + s.trigger.length)}</mark>
          {full.slice(i + s.trigger.length)}
        </>
      );
    }
  }
  return (
    <pre className="intercept__payload alab-payload">
      <span className="sr-only">{full}</span>
      {/* The full text sizes the box, so typing never shifts the layout. */}
      <span className="alab-payload__ghost" aria-hidden="true">
        {full}
      </span>
      <span className="alab-payload__live" aria-hidden="true">
        {live}
        {phase === 'type' ? <span className="alab-caret" /> : null}
      </span>
    </pre>
  );
}

export function GateConsole({
  s,
  phase,
  typed,
  passKey,
  head,
  foot,
  hero = false,
}: {
  s: Sim;
  phase: Phase;
  typed: number;
  passKey: string;
  head: ReactNode;
  foot?: ReactNode;
  hero?: boolean;
}) {
  const blocked = s.verdict === 'BLOCKED';
  const decided = phase === 'verdict' || phase === 'rest';
  const reading = phase === 'scan';
  const waiting = phase === 'ready' || phase === 'type' || phase === 'transit';
  const [from, to] = s.direction === 'call' ? ['Agent', 'Tool'] : ['Tool', 'Agent'];
  const step = phase === 'ready' ? -1 : phase === 'type' ? 0 : decided ? 2 : 1;
  const danger = blocked || Boolean(s.bad);
  const tone = decided ? (danger ? 'block' : 'allow') : reading ? 'read' : 'idle';
  const pct = useCountUp(s.pUnsafe * 100, reading, 1100);
  const shownPct = reading ? pct : s.pUnsafe * 100;

  return (
    <div className={`console alab-gate alab-gate--${tone}${hero ? ' alab-gate--hero' : ''}`}>
      {head}

      <ol className="alab-steps" aria-label="Decision steps">
        {STEPS.map((item, i) => (
          <li key={item.t} className={i === step ? 'is-on' : i < step ? 'is-done' : undefined}>
            <span className="alab-steps__n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="alab-steps__t">{item.t}</span>
            {hero ? <span className="alab-steps__d">{item.d}</span> : null}
          </li>
        ))}
      </ol>

      <div className={`path alab-path${decided ? (blocked ? ' path--block' : s.bad ? '' : ' path--allow') : ''}`} aria-hidden="true">
        <span className="path__node">{from}</span>
        <span className="path__seg">
          {phase === 'transit' || phase === 'scan' || phase === 'verdict' ? (
            <span key={`in-${passKey}`} className="path__packet" />
          ) : null}
        </span>
        <span
          className={`path__node path__node--gate${phase === 'verdict' && blocked ? ' is-tripped' : ''}${
            reading ? ' is-reading' : ''
          }`}
        >
          {decided && blocked ? <ShieldX size={13} strokeWidth={1.75} /> : <ShieldCheck size={13} strokeWidth={1.75} />}
          Protocol X
        </span>
        <span className="path__seg path__seg--out">
          {phase === 'verdict' && !blocked ? (
            <span key={`out-${passKey}`} className="path__packet path__packet--late" />
          ) : null}
        </span>
        <span className="path__node">{to}</span>
      </div>

      <div className="alab-payload-wrap">
        <span className="alab-dir">
          {s.direction === 'call' ? 'Tool call' : 'Tool result'} · <code>{s.tool}</code>
        </span>
        <Payload s={s} typed={typed} phase={phase} />
        {reading ? <span key={`scan-${passKey}`} className="alab-scan" aria-hidden="true" /> : null}
      </div>

      <div className={`alab-gauge alab-gauge--${tone}`}>
        <span className="alab-gauge__label">Probability this is an attack</span>
        <span className="alab-gauge__track" aria-hidden="true">
          <span className="alab-gauge__fill" style={{ width: `${waiting ? 0 : s.pUnsafe * 100}%` }} />
        </span>
        <span className="alab-gauge__val">{waiting ? '—' : `${shownPct.toFixed(1)}%`}</span>
      </div>

      <div className={`verdict${decided ? (danger ? ' verdict--block' : ' verdict--allow') : ' alab-verdict--pending'}`}>
        <span
          className={`status ${
            decided ? (danger ? 'status--block' : 'status--allow') : reading ? 'status--evaluating' : 'status--idle'
          }`}
        >
          <span className="status__mark" aria-hidden="true">
            {decided && blocked ? '×' : decided && s.bad ? '!' : '●'}
          </span>
          {decided ? (s.label ?? (blocked ? 'Blocked' : 'Allowed')) : reading ? 'Reading' : phase === 'ready' ? 'Ready' : 'Arriving'}
        </span>
        <span className="verdict__bytes">
          {decided
            ? s.outcome
            : phase === 'ready'
              ? 'Not sent yet.'
              : `Protocol X is reading the ${s.direction === 'call' ? 'call' : 'result'}…`}
        </span>
        <span className="verdict__lat">{decided ? `${s.latencyMs} ms` : '—'}</span>
      </div>

      {foot}
    </div>
  );
}

export function PlayToggle({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="icon-btn alab-toggle"
      onClick={onToggle}
      aria-label={paused ? 'Play the simulation' : 'Pause the simulation'}
      data-tip={paused ? 'Play' : 'Pause'}
    >
      {paused ? <Play size={14} strokeWidth={1.75} aria-hidden="true" /> : <Pause size={14} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}

/** An attack's own simulation: plays whenever it is on screen and loops until it leaves. */
export function AttackSim({ a }: { a: AttackEntry }) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(0.35);
  const [paused, setPaused] = useState(false);
  const [pass, setPass] = useState(0);
  const s: Sim = {
    direction: a.carrier,
    tool: a.tool,
    payload: a.payload,
    trigger: a.trigger,
    verdict: 'BLOCKED',
    pUnsafe: a.pUnsafe,
    latencyMs: a.latencyMs,
    outcome:
      a.carrier === 'call' ? 'Threat stopped. The call never reaches the tool.' : 'Threat stopped. The result never reaches the agent.',
  };
  const { phase, typed } = useGatePass(inView && !reduced && !paused, s.payload.length, 3600, String(pass), () =>
    setPass((p) => p + 1),
  );

  return (
    <div ref={ref} className="alab-sim">
      <GateConsole
        s={s}
        phase={phase}
        typed={typed}
        passKey={String(pass)}
        head={
          <div className="console__head">
            <span className="console__id">
              <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" />
              protocol-x
              <span className="dim">· {a.carrier === 'call' ? 'tool call' : 'tool result'}</span>
            </span>
            <span className="alab-src">{a.source}</span>
            {reduced ? null : <PlayToggle paused={paused} onToggle={() => setPaused((v) => !v)} />}
          </div>
        }
        foot={
          <p className="intercept__note alab-why">
            <span className="intercept__note-key">What triggered the block</span>
            <span className="alab-why__quote">{a.trigger}</span>
          </p>
        }
      />
    </div>
  );
}

/** The opening explainer: cycles an allowed call and two blocked ones until the visitor picks one. */
export function HowItWorksSim() {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(0.25);
  const [idx, setIdx] = useState(0);
  const [pass, setPass] = useState(0);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const sc = HOW_SCENARIOS[idx];
  const { phase, typed } = useGatePass(inView && !reduced && !paused, sc.payload.length, 3000, `${idx}-${pass}`, () => {
    if (held) setPass((p) => p + 1);
    else setIdx((i) => (i + 1) % HOW_SCENARIOS.length);
  });

  const pick = (i: number) => {
    setHeld(true);
    setPaused(false);
    setIdx(i);
    setPass((p) => p + 1);
  };

  return (
    <div ref={ref} className="alab-sim">
      <GateConsole
        hero
        s={sc}
        phase={phase}
        typed={typed}
        passKey={`${idx}-${pass}`}
        head={
          <div className="console__head alab-hero-head">
            <span className="console__id">
              <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" />
              mastyf
              <span className="dim">· protocol-x</span>
            </span>
            <div className="alab-pills" role="group" aria-label="Pick a scenario">
              {HOW_SCENARIOS.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  className={`alab-pill alab-pill--${item.verdict === 'BLOCKED' ? 'block' : 'allow'}`}
                  aria-pressed={i === idx}
                  onClick={() => pick(i)}
                >
                  <span className="alab-pill__mark" aria-hidden="true">
                    {item.verdict === 'BLOCKED' ? '×' : '●'}
                  </span>
                  {item.label}
                </button>
              ))}
            </div>
            {reduced ? null : <PlayToggle paused={paused} onToggle={() => setPaused((v) => !v)} />}
          </div>
        }
        foot={
          <div className="console__foot">
            <span>
              Real recorded runs on a laptop CPU. In the same check, {BENIGN_CHECK.allowed} of {BENIGN_CHECK.scored} ordinary
              tool calls were allowed.
            </span>
            <span className="alab-hint">{held ? 'Holding your pick.' : 'Cycling through three cases; pick one to hold it.'}</span>
          </div>
        }
      />
    </div>
  );
}

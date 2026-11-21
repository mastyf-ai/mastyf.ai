'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, FileText, FolderOpen, KeyRound, Leaf, Route, Wrench } from 'lucide-react';
import { useReducedMotion } from '@/app/attack-lab/GateSim';
import type { PlayExample } from '@/app/attack-lab/playground-types';
import {
  ARENA_DISGUISES,
  ARENA_GOALS,
  cellPool,
  splitPayload,
  verdictFor,
  type ArenaDisguiseId,
  type ArenaGoalId,
  type Release,
} from './arena-data';

/**
 * Throw a recorded attack at Protocol X: pick what the attacker wants and how it is disguised, then
 * watch the packet fly into the model, the meter fill to the recorded score, and the verdict. Plays
 * on its own until the visitor picks something. Nothing calls the model; every verdict is the
 * current model's recorded one.
 */

type Phase = 'idle' | 'travel' | 'scan' | 'blocked' | 'passed';

const ICONS: Record<ArenaGoalId, typeof Bot> = {
  'prompt-injection': Bot,
  'credential-exfil': KeyRound,
  'cross-tool-chain': Route,
  'boundary-evasion': FolderOpen,
  harmless: Leaf,
};

const TIMING = { travel: 700, scan: 1100, hold: 1900 };
const RING = 2 * Math.PI * 46;
const SHARDS = Array.from({ length: 10 }, (_, i) => i);
const AUTO: [ArenaGoalId, ArenaDisguiseId][] = [
  ['credential-exfil', 'delayed-trigger'],
  ['prompt-injection', 'split-assembly'],
  ['harmless', 'error-recovery'],
  ['boundary-evasion', 'error-recovery'],
  ['cross-tool-chain', 'delayed-trigger'],
  ['credential-exfil', 'split-assembly'],
];

type Throw = { goal: ArenaGoalId; disguise: ArenaDisguiseId; example: PlayExample; release: Release; n: number };

export function PxArena() {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [current, setCurrent] = useState<Throw | null>(null);
  const [auto, setAuto] = useState(true);
  const [goal, setGoal] = useState<ArenaGoalId>('credential-exfil');
  const [disguise, setDisguise] = useState<ArenaDisguiseId>('delayed-trigger');
  const release: Release = 'now';
  const [history, setHistory] = useState<{ blocked: boolean; harmless: boolean }[]>([]);
  const cursors = useRef<Record<string, number>>({});
  const timers = useRef<number[]>([]);
  const autoStep = useRef(0);
  const count = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);

  // Auto-play only while the arena is on screen: nothing changes size above the gauntlet while it runs.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const play = useCallback(
    (g: ArenaGoalId, d: ArenaDisguiseId, r: Release, example?: PlayExample) => {
      clear();
      let ex = example;
      if (!ex) {
        const pool = cellPool(g, d);
        const key = `${g}:${d}`;
        const i = (cursors.current[key] ?? 0) % pool.length;
        cursors.current[key] = i + 1;
        ex = pool[i];
      }
      if (!ex) return;
      count.current += 1;
      setCurrent({ goal: g, disguise: d, example: ex, release: r, n: count.current });
      const v = verdictFor(ex, r);
      const verdict: Phase = v?.blocked ? 'blocked' : 'passed';
      const record = () =>
        setHistory((h) => [...h, { blocked: Boolean(v?.blocked), harmless: g === 'harmless' }].slice(-30));
      if (reduced) {
        setPhase(verdict);
        record();
        return;
      }
      setPhase('travel');
      timers.current.push(window.setTimeout(() => setPhase('scan'), TIMING.travel));
      timers.current.push(
        window.setTimeout(() => {
          setPhase(verdict);
          record();
        }, TIMING.travel + TIMING.scan),
      );
    },
    [reduced],
  );

  useEffect(() => {
    if (!auto || reduced || !onScreen) return;
    const step = () => {
      const [g, d] = AUTO[autoStep.current % AUTO.length];
      autoStep.current += 1;
      setGoal(g);
      setDisguise(d);
      play(g, d, 'now');
    };
    const first = window.setTimeout(step, 600);
    const loop = window.setInterval(step, TIMING.travel + TIMING.scan + TIMING.hold);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(loop);
    };
  }, [auto, reduced, onScreen, play]);

  useEffect(() => clear, []);

  const pickGoal = (g: ArenaGoalId) => {
    setAuto(false);
    setGoal(g);
    play(g, disguise, release);
  };
  const pickDisguise = (d: ArenaDisguiseId) => {
    setAuto(false);
    setDisguise(d);
    play(goal, d, release);
  };

  const ex = current?.example;
  const v = ex && current ? verdictFor(ex, current.release) : null;
  const isCall = ex?.carrier === 'call';
  const scored = phase === 'scan' || phase === 'blocked' || phase === 'passed';
  const p = v && scored ? v.p : 0;
  const stopped = history.filter((h) => h.blocked && !h.harmless).length;
  const attacks = history.filter((h) => !h.harmless).length;

  return (
    <div className="pxa" ref={rootRef} data-phase={phase} data-release={current?.release ?? 'now'}>
      <div className="pxa__controls">
        <div className="pxa__goals" role="group" aria-label="What the attacker wants">
          {ARENA_GOALS.map((g) => {
            const Icon = ICONS[g.id];
            return (
              <button
                key={g.id}
                type="button"
                className={`pxa__goal${g.id === 'harmless' ? ' pxa__goal--calm' : ''}`}
                aria-pressed={goal === g.id}
                onClick={() => pickGoal(g.id)}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                <span>{g.label}</span>
              </button>
            );
          })}
        </div>
        <div className="pxa__row">
          <div className="pxa__seg" role="group" aria-label="How it is disguised">
            {ARENA_DISGUISES.map((d) => (
              <button key={d.id} type="button" aria-pressed={disguise === d.id} onClick={() => pickDisguise(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pxa__stage" aria-hidden="true">
        <div className="pxa__track" />
        <div className="pxa__node pxa__node--from">
          {isCall ? <Bot size={22} strokeWidth={1.5} /> : <FileText size={22} strokeWidth={1.5} />}
          <span>{isCall ? 'Agent call' : 'Tool result'}</span>
        </div>
        <div className="pxa__core">
          <svg viewBox="0 0 100 100" className="pxa__ring">
            <circle cx="50" cy="50" r="46" className="pxa__ring-bg" />
            <circle cx="50" cy="50" r="46" className="pxa__ring-fill" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - p) }} />
          </svg>
          <div className="pxa__orbit" />
          <div className="pxa__orbit pxa__orbit--2" />
          <strong className="pxa__core-label">X</strong>
          <span className="pxa__score">{scored && v ? `${Math.round(v.p * 100)}` : ''}</span>
        </div>
        <div className="pxa__node pxa__node--to">
          {isCall ? <Wrench size={22} strokeWidth={1.5} /> : <Bot size={22} strokeWidth={1.5} />}
          <span>{isCall ? 'Your tool' : 'Your agent'}</span>
        </div>
        {current ? (
          <div key={current.n} className="pxa__packet">
            <span className="pxa__packet-dot" />
            <span className="pxa__packet-tool">{ex?.tool}</span>
            {SHARDS.map((i) => (
              <i key={i} className="pxa__shard" style={{ ['--a' as string]: `${i * 36}deg` }} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="pxa__readout" aria-live="polite">
        {ex && v && (phase === 'blocked' || phase === 'passed') ? (
          <p className={`pxa__verdict pxa__verdict--${phase}`}>
            <b>{phase === 'blocked' ? 'Blocked' : 'Let through'}</b>
            <span>{Math.round(v.p * 100)}% attack</span>
            {v.ms ? <span>{(v.ms / 1000).toFixed(1)} s</span> : null}
            {current?.goal !== 'harmless' && phase === 'passed' ? <span className="pxa__miss">missed</span> : null}
          </p>
        ) : (
          <p className="pxa__verdict pxa__verdict--wait">{phase === 'idle' ? 'Pick an attack' : 'Checking…'}</p>
        )}
        <div className="pxa__tally" title="Your throws">
          <span className="pxa__dots">
            {history.map((h, i) => (
              <i key={i} className={h.harmless ? 'is-calm' : h.blocked ? 'is-stop' : 'is-miss'} />
            ))}
          </span>
          {attacks > 0 ? (
            <span>
              {stopped}/{attacks} stopped
            </span>
          ) : null}
        </div>
      </div>

      <pre className="pxa__payload" key={current?.n ?? 0}>
        {ex
          ? splitPayload(ex.payload, ex.hidden).map((part, i) =>
              part.hidden ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
            )
          : null}
      </pre>
    </div>
  );
}

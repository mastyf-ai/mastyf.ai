'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, FolderOpen, KeyRound, Leaf, Route, Wrench, FileText } from 'lucide-react';
import { useReducedMotion } from '@/app/attack-lab/GateSim';
import type { PlayExample } from '@/app/attack-lab/playground-types';
import { ARENA_GOALS, nextThrow, splitPayload, type ArenaGoalId } from './arena-data';

/**
 * Throw a recorded attack at Protocol X and watch it: the packet flies into the model, the meter
 * fills to the recorded attack score, then it is stopped or let through. Plays on its own until the
 * visitor picks something. Every verdict, score and time is a recording; nothing calls the model.
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

type Throw = { goal: ArenaGoalId; example: PlayExample; n: number };

export function PxArena() {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [current, setCurrent] = useState<Throw | null>(null);
  const [auto, setAuto] = useState(true);
  const [history, setHistory] = useState<{ blocked: boolean; harmless: boolean }[]>([]);
  const cursors = useRef<Record<string, number>>({});
  const timers = useRef<number[]>([]);
  const autoGoal = useRef(0);
  const count = useRef(0);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const fire = useCallback(
    (goal: ArenaGoalId) => {
      clear();
      const { example, next } = nextThrow(goal, cursors.current[goal] ?? 0);
      cursors.current[goal] = next;
      count.current += 1;
      setCurrent({ goal, example, n: count.current });
      const verdict: Phase = example.now.blocked ? 'blocked' : 'passed';
      const record = () =>
        setHistory((h) => [...h, { blocked: example.now.blocked, harmless: goal === 'harmless' }].slice(-24));
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

  // Plays by itself until the visitor picks something (never with reduced motion).
  useEffect(() => {
    if (!auto || reduced) return;
    const order: ArenaGoalId[] = ['credential-exfil', 'prompt-injection', 'harmless', 'boundary-evasion', 'cross-tool-chain'];
    const step = () => {
      fire(order[autoGoal.current % order.length]);
      autoGoal.current += 1;
    };
    const first = window.setTimeout(step, 600);
    const loop = window.setInterval(step, TIMING.travel + TIMING.scan + TIMING.hold);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(loop);
    };
  }, [auto, reduced, fire]);

  useEffect(() => clear, []);

  const pick = (goal: ArenaGoalId) => {
    setAuto(false);
    fire(goal);
  };

  const ex = current?.example;
  const isCall = ex?.carrier === 'call';
  const scored = phase === 'scan' || phase === 'blocked' || phase === 'passed';
  const p = ex && scored ? ex.now.p : 0;
  const stopped = history.filter((h) => h.blocked && !h.harmless).length;
  const attacks = history.filter((h) => !h.harmless).length;

  return (
    <div className="pxa" data-phase={phase}>
      <div className="pxa__goals" role="group" aria-label="Pick an attack to throw">
        {ARENA_GOALS.map((g) => {
          const Icon = ICONS[g.id];
          return (
            <button
              key={g.id}
              type="button"
              className={`pxa__goal${g.id === 'harmless' ? ' pxa__goal--calm' : ''}`}
              aria-pressed={current?.goal === g.id}
              onClick={() => pick(g.id)}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>{g.label}</span>
            </button>
          );
        })}
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
            <circle
              cx="50"
              cy="50"
              r="46"
              className="pxa__ring-fill"
              style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - p) }}
            />
          </svg>
          <div className="pxa__orbit" />
          <div className="pxa__orbit pxa__orbit--2" />
          <strong className="pxa__core-label">X</strong>
          <span className="pxa__score">{scored && ex ? `${Math.round(ex.now.p * 100)}` : ''}</span>
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
        {ex && (phase === 'blocked' || phase === 'passed') ? (
          <p className={`pxa__verdict pxa__verdict--${phase}`}>
            <b>{phase === 'blocked' ? 'Blocked' : 'Let through'}</b>
            <span>{Math.round(ex.now.p * 100)}% attack</span>
            {ex.now.ms ? <span>{(ex.now.ms / 1000).toFixed(1)} s</span> : null}
            {current?.goal !== 'harmless' && phase === 'passed' ? <span className="pxa__miss">recorded miss</span> : null}
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

      {ex ? (
        <pre className="pxa__payload" key={current?.n}>
          {splitPayload(ex.payload, ex.hidden).map((part, i) =>
            part.hidden ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
          )}
        </pre>
      ) : null}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { useReducedMotion } from '@/app/attack-lab/GateSim';
import {
  ARENA_DISGUISES,
  ARENA_GOALS,
  GAUNTLET,
  SUITE,
  scoreGauntlet,
  verdictFor,
  type Release,
} from './arena-data';

/**
 * The gauntlet: every recorded case (60 attacks, 15 harmless twins) fired at one model in a few
 * seconds. Each dot lands on its goal × disguise cell as its recorded verdict comes in. Nothing calls
 * the model; every dot is the current model's recorded verdict.
 */

const STEP_MS = 85;
const ROWS = ARENA_GOALS.map((g) => g.id);

export function PxGauntlet() {
  const reduced = useReducedMotion();
  const release: Release = 'now';
  const [shown, setShown] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };

  const run = () => {
    stop();
    if (reduced) {
      setShown(GAUNTLET.length);
      setRunning(false);
      return;
    }
    setShown(0);
    setRunning(true);
    timer.current = window.setInterval(() => {
      setShown((n) => {
        if (n + 1 >= GAUNTLET.length) {
          stop();
          setRunning(false);
          return GAUNTLET.length;
        }
        return n + 1;
      });
    }, STEP_MS);
  };

  useEffect(() => stop, []);

  // Running tallies over the cases shown so far.
  let stopped = 0, attacks = 0, falseAlarms = 0, harmless = 0;
  GAUNTLET.slice(0, shown).forEach((c) => {
    const v = verdictFor(c.example, release);
    if (!v) return;
    if (c.harmless) { harmless++; if (v.blocked) falseAlarms++; }
    else { attacks++; if (v.blocked) stopped++; }
  });
  const final = scoreGauntlet(release);
  const latest = shown > 0 ? GAUNTLET[shown - 1] : null;
  const latestV = latest ? verdictFor(latest.example, release) : null;
  const done = shown === GAUNTLET.length;

  return (
    <div className="pxg" data-release={release}>
      <div className="pxg__bar">
        <button type="button" className="btn btn-primary" onClick={run} disabled={running}>
          {done ? <RotateCcw size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          {done ? 'Run them again' : `Run all ${GAUNTLET.length}`}
        </button>
      </div>

      <div className="pxg__board">
        <div className="pxg__grid" role="img" aria-label={`${stopped} of ${attacks} attacks stopped, ${falseAlarms} of ${harmless} harmless calls blocked`}>
          <span />
          {ARENA_DISGUISES.map((d) => (
            <span key={d.id} className="pxg__colhead">
              {d.label}
            </span>
          ))}
          {ROWS.map((goal) => (
            <div key={goal} className="pxg__rowwrap" style={{ display: 'contents' }}>
              <span className={`pxg__rowhead${goal === 'harmless' ? ' pxg__rowhead--calm' : ''}`}>
                {ARENA_GOALS.find((g) => g.id === goal)?.label}
              </span>
              {ARENA_DISGUISES.map((d) => (
                <span key={d.id} className="pxg__cell">
                  {GAUNTLET.map((c, i) => ({ c, i }))
                    .filter(({ c }) => c.goal === goal && c.disguise === d.id)
                    .map(({ c, i }) => {
                      const v = verdictFor(c.example, release);
                      const state = i >= shown || !v ? 'wait' : c.harmless ? (v.blocked ? 'false' : 'calm') : v.blocked ? 'stop' : 'miss';
                      return (
                        <i
                          key={c.example.id}
                          className={`pxg__dot is-${state}${i === shown - 1 ? ' is-new' : ''}`}
                          title={state === 'wait' ? '' : `${c.example.tool}: ${Math.round((v?.p ?? 0) * 100)}% attack`}
                        />
                      );
                    })}
                </span>
              ))}
            </div>
          ))}
        </div>

        <div className="pxg__score" aria-live="polite">
          <div>
            <b className="pxg__n">
              {stopped}
              <small>/{done ? final.attacks : 60}</small>
            </b>
            <span>attacks stopped</span>
          </div>
          <div>
            <b className={`pxg__n${falseAlarms ? ' is-bad' : ' is-good'}`}>
              {falseAlarms}
              <small>/{done ? final.harmless : 15}</small>
            </b>
            <span>harmless calls blocked</span>
          </div>
          <div>
            <b className="pxg__n pxg__n--small">{done && final.medianMs ? `${(final.medianMs / 1000).toFixed(1)} s` : '—'}</b>
            <span>median decision</span>
          </div>
          <p className="pxg__ticker">
            {latest && latestV ? (
              <>
                <code>{latest.example.tool}</code> {latestV.blocked ? 'blocked' : 'let through'} ·{' '}
                {Math.round(latestV.p * 100)}%
              </>
            ) : (
              'Ready'
            )}
          </p>
        </div>
      </div>

      <p className="pxg__suite">
        Full red-team suite: {SUITE.now.caught}/{SUITE.now.attacks} stopped, {SUITE.now.wronglyBlocked}/
        {SUITE.now.harmless} harmless calls blocked.
      </p>
    </div>
  );
}

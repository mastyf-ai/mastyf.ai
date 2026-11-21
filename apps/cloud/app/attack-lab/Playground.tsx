'use client';

import { useState } from 'react';
import { RotateCcw, Send, ShieldCheck } from 'lucide-react';
import { GateConsole, useGatePass, useReducedMotion, type Phase, type Sim } from './GateSim';
import { PLAYGROUND } from './playground-data';
import type { Count, PlayExample } from './playground-types';

/**
 * Try an attack: the visitor picks a goal and a disguise (or the harmless version of that disguise),
 * sends it, and watches Protocol X's real recorded verdict. "Try another" steps through the other
 * recorded examples in the same group, misses included. Nothing here calls a model: every verdict,
 * probability and time is a recording.
 */

type Sent = 'no' | 'playing' | 'done';

const pct = (c: Count) => (c ? Math.round((c[0] / c[1]) * 100) : null);

function outcome(ex: PlayExample, harmless: boolean): string {
  const into = ex.carrier === 'call' ? 'the tool' : 'the agent';
  if (harmless) return ex.now.blocked ? `This harmless text never reached ${into}.` : `Harmless text goes through to ${into}.`;
  return ex.now.blocked ? `The attack never reaches ${into}.` : `This attack reached ${into}.`;
}

function ChoiceGroup({
  label,
  options,
  value,
  onPick,
  disabled = false,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="alab-pills alab-play__choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          className="alab-pill"
          aria-checked={o.id === value}
          disabled={disabled}
          onClick={() => onPick(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BeforeNow({ ex, harmless, sent }: { ex: PlayExample; harmless: boolean; sent: boolean }) {
  if (!sent || !ex.before) return null;
  const word = (blocked: boolean) => (harmless ? (blocked ? 'wrongly blocked it' : 'let it through') : blocked ? 'blocked it' : 'let it through');
  const good = (blocked: boolean) => (harmless ? !blocked : blocked);
  return (
    <dl className="alab-play__releases">
      <div>
        <dt>{PLAYGROUND.releases.before}</dt>
        <dd className={good(ex.before.blocked) ? 'is-good' : 'is-bad'}>
          {word(ex.before.blocked)} <span className="dim">· {(ex.before.p * 100).toFixed(1)}%</span>
        </dd>
      </div>
      <div>
        <dt>{PLAYGROUND.releases.now}</dt>
        <dd className={good(ex.now.blocked) ? 'is-good' : 'is-bad'}>
          {word(ex.now.blocked)} <span className="dim">· {(ex.now.p * 100).toFixed(1)}%</span>
        </dd>
      </div>
    </dl>
  );
}

export function Playground() {
  const reduced = useReducedMotion();
  const [goal, setGoal] = useState(PLAYGROUND.goals[0].id);
  const [disguise, setDisguise] = useState(PLAYGROUND.disguises[0].id);
  const [harmless, setHarmless] = useState(false);
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState<Sent>('no');
  const [pass, setPass] = useState(0);

  const cell = PLAYGROUND.cells[`${goal}:${disguise}`];
  const twin = PLAYGROUND.harmless[disguise];
  const list = harmless ? twin.examples : cell.examples;
  const ex = list[index % list.length];
  const d = PLAYGROUND.disguises.find((x) => x.id === disguise)!;
  const g = PLAYGROUND.goals.find((x) => x.id === goal)!;

  const sim: Sim = {
    direction: ex.carrier,
    tool: ex.tool,
    payload: ex.payload,
    trigger: ex.hidden,
    verdict: ex.now.blocked ? 'BLOCKED' : 'ALLOWED',
    pUnsafe: ex.now.p,
    latencyMs: ex.now.ms ?? 0,
    outcome: outcome(ex, harmless),
    bad: harmless ? ex.now.blocked : !ex.now.blocked,
    label: harmless && ex.now.blocked ? 'Wrongly blocked' : !harmless && !ex.now.blocked ? 'Got through' : undefined,
  };

  const passKey = `${ex.id}-${pass}`;
  const animate = sent === 'playing' && !reduced;
  const { phase, typed } = useGatePass(animate, ex.payload.length, 0, passKey, () => setSent('done'));
  const shown: Phase = sent === 'no' ? 'ready' : phase;
  const finished = sent === 'done' || (sent === 'playing' && reduced);

  const reset = () => {
    setIndex(0);
    setSent('no');
  };
  const send = () => {
    setPass((p) => p + 1);
    setSent('playing');
  };
  const another = () => {
    setIndex((i) => i + 1);
    setPass((p) => p + 1);
    setSent('playing');
  };

  const count = harmless ? twin.wronglyBlocked : cell.caught;
  const total = count.now ? count.now[1] : list.length;

  return (
    <div className="alab-play">
      <div className="alab-play__setup">
        <div className="alab-play__step">
          <p className="alab-play__q">
            <span className="alab-steps__n" aria-hidden="true">1</span> What does the attacker want?
          </p>
          <ChoiceGroup
            label="Attacker's goal"
            options={PLAYGROUND.goals}
            value={goal}
            disabled={harmless}
            onPick={(id) => {
              setGoal(id);
              reset();
            }}
          />
          <p className="alab-play__line">{harmless ? 'The harmless version carries no attack, so there is no goal.' : g.line}</p>
        </div>
        <div className="alab-play__step">
          <p className="alab-play__q">
            <span className="alab-steps__n" aria-hidden="true">2</span> How is it disguised?
          </p>
          <ChoiceGroup
            label="Disguise"
            options={PLAYGROUND.disguises}
            value={disguise}
            onPick={(id) => {
              setDisguise(id);
              reset();
            }}
          />
          <p className="alab-play__line">{d.line}</p>
        </div>
        <div className="alab-play__step alab-play__send">
          <p className="alab-play__q">
            <span className="alab-steps__n" aria-hidden="true">3</span> Send it through Protocol X
          </p>
          <div className="alab-play__actions">
            <button
              type="button"
              role="switch"
              aria-checked={harmless}
              className="switch"
              onClick={() => {
                setHarmless((v) => !v);
                reset();
              }}
            >
              <span className="switch__track" aria-hidden="true">
                <span className="switch__thumb" />
              </span>
              Harmless version
            </button>
            {finished ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={another}>
                <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" /> Try another example
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={sent === 'playing'}>
                <Send size={14} strokeWidth={1.75} aria-hidden="true" /> Send it
              </button>
            )}
          </div>
          <p className="alab-play__line">
            Example {(index % list.length) + 1} of {list.length} recorded for this choice.
          </p>
        </div>
      </div>

      <div className="alab-sim" aria-live="polite">
        <GateConsole
          s={sim}
          phase={shown}
          typed={typed}
          passKey={passKey}
          head={
            <div className="console__head">
              <span className="console__id">
                <ShieldCheck size={14} strokeWidth={1.75} aria-hidden="true" />
                protocol-x
                <span className="dim">· {harmless ? 'harmless version' : 'your attack'}</span>
              </span>
              <span className="alab-src">recorded run · {ex.id}</span>
            </div>
          }
          foot={
            <>
              {ex.hidden && finished ? (
                <p className="intercept__note alab-why">
                  <span className="intercept__note-key">The attacker&apos;s instruction</span>
                  <span className="alab-why__quote">{ex.hidden}</span>
                </p>
              ) : null}
              <BeforeNow ex={ex} harmless={harmless} sent={finished} />
              <div className="console__foot">
                <span>
                  {count.now
                    ? harmless
                      ? `Across all ${total} harmless examples of this disguise, the ${PLAYGROUND.releases.now} wrongly blocked ${count.now[0]}`
                      : `Across all ${total} recorded attacks with this goal and disguise, the ${PLAYGROUND.releases.now} stopped ${count.now[0]}`
                    : null}
                  {count.now && count.before ? `; the ${PLAYGROUND.releases.before}, ${count.before[0]}.` : count.now ? "." : null}
                </span>
              </div>
            </>
          }
        />
      </div>
    </div>
  );
}

/** Then and now: the same novel attacks scored by the previous release and the current one. */
export function ThenAndNow() {
  const rows = PLAYGROUND.disguises.map((d) => ({ d, f: PLAYGROUND.families[d.id] }));
  if (rows.some(({ f }) => !f?.caught.before || !f?.wronglyBlocked.before)) return null;
  return (
    <div className="doc-block alab-then">
      <table className="alab-then__table">
        <caption className="sr-only">Attacks stopped and harmless text wrongly blocked, by release</caption>
        <thead>
          <tr>
            <th scope="col">Disguise</th>
            <th scope="col">Attacks stopped</th>
            <th scope="col">Harmless text wrongly blocked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ d, f }) => (
            <tr key={d.id}>
              <th scope="row">{d.label}</th>
              <td>
                <span className="alab-then__from">{pct(f.caught.before)}%</span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> to </span>
                <span className="alab-then__to">{pct(f.caught.now)}%</span>
                <span className="alab-then__n">
                  {f.caught.now![0]} of {f.caught.now![1]}
                </span>
              </td>
              <td>
                <span className="alab-then__from">{pct(f.wronglyBlocked.before)}%</span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> to </span>
                <span className="alab-then__to">{pct(f.wronglyBlocked.now)}%</span>
                <span className="alab-then__n">
                  {f.wronglyBlocked.now![0]} of {f.wronglyBlocked.now![1]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="doc-note">
        Left: the {PLAYGROUND.releases.before}. Right: the {PLAYGROUND.releases.now}. Same attacks, same harmless
        text, scored on a laptop CPU. Neither release was trained on these disguises.
      </p>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { ATTACKERS, GOALS, LAYERS, OUTCOMES, type AttackerId, type GoalId } from '@/lib/authority/scenarios';

const STATE_LABEL = { pass: 'passed', stop: 'stopped', cap: 'capped', hold: 'held', watch: 'watching', skip: 'not reached' } as const;

export function AttackSimulator() {
  const [attacker, setAttacker] = useState<AttackerId>('password');
  const [goal, setGoal] = useState<GoalId>('data');
  const [run, setRun] = useState(0);
  const o = OUTCOMES[attacker][goal];

  useEffect(() => setRun((r) => r + 1), [attacker, goal]);

  return (
    <div className="auth-sim">
      <div className="auth-sim__controls">
        <fieldset className="auth-choice">
          <legend>Who is attacking</legend>
          {ATTACKERS.map((a) => (
            <button key={a.id} type="button" aria-pressed={attacker === a.id} onClick={() => setAttacker(a.id)}
                    className="auth-choice__btn">
              <span>{a.label}</span>
              <small>{a.hint}</small>
            </button>
          ))}
        </fieldset>
        <fieldset className="auth-choice">
          <legend>What they want</legend>
          {GOALS.map((g) => (
            <button key={g.id} type="button" aria-pressed={goal === g.id} onClick={() => setGoal(g.id)}
                    className="auth-choice__btn auth-choice__btn--compact">
              <span>{g.label}</span>
            </button>
          ))}
        </fieldset>
      </div>

      <div className="auth-sim__stage" key={run} aria-live="polite">
        <ol className="auth-path">
          {LAYERS.map((l, i) => {
            const st = o.steps[l.id] ?? { state: 'skip' as const, note: '' };
            return (
              <li key={l.id} className={`auth-path__step auth-path__step--${st.state}`} style={{ animationDelay: `${i * 140}ms` }}>
                <span className="auth-path__dot" aria-hidden="true" />
                <span className="auth-path__name">{l.name}</span>
                <span className="auth-path__state">{STATE_LABEL[st.state]}</span>
                {st.note ? <span className="auth-path__note">{st.note}</span> : null}
              </li>
            );
          })}
        </ol>
        <div className={`auth-result auth-result--${o.verdict.toLowerCase()}`} style={{ animationDelay: `${LAYERS.length * 140}ms` }}>
          <p className="auth-result__verdict">{o.verdict}</p>
          <p className="auth-result__headline">{o.headline}</p>
          <p className="auth-result__detail">{o.detail}</p>
          <p className="auth-result__evidence">Measured: {o.evidence}</p>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PencilLine, RotateCcw, Shuffle } from 'lucide-react';
import { PLAYGROUND } from '@/lib/protocol-x/playground-data';
import type { PlayExample, Count } from '@/lib/protocol-x/playground-types';
import { BENIGN_CHECK, PX_RESULTS } from '@/lib/protocol-x/recorded';
import { checkWithLocalRules, type RuleCheckResult } from '@/lib/mastyf-ai-api';

type GoalId = string; // a PLAYGROUND goal id, or 'harmless'

type Parsed =
  | { ok: true; kind: 'call'; tool: string; args: Record<string, unknown> }
  | { ok: true; kind: 'result'; tool: string; result: string }
  | { ok: false; error: string };

/** Payloads are recorded as "MCP tool call|result / Tool: x / Arguments|Result: ...". */
export function parsePayload(text: string): Parsed {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const head = (lines[0] || '').trim().toLowerCase();
  const kind = head.includes('result') ? 'result' : head.includes('call') ? 'call' : null;
  if (!kind) return { ok: false, error: 'Start the first line with “MCP tool call” or “MCP tool result”.' };
  const toolLine = lines.find((l) => /^tool:/i.test(l.trim()));
  const tool = toolLine ? toolLine.trim().slice(5).trim() : '';
  if (!tool) return { ok: false, error: 'Add a line like “Tool: read_file”.' };
  const bodyIdx = lines.findIndex((l) => /^(arguments|result):/i.test(l.trim()));
  if (bodyIdx < 0) return { ok: false, error: kind === 'call' ? 'Add an “Arguments: {…}” line.' : 'Add a “Result: …” line.' };
  const first = lines[bodyIdx].trim().replace(/^(arguments|result):\s*/i, '');
  const body = [first, ...lines.slice(bodyIdx + 1)].join('\n').trim();
  if (kind === 'result') return { ok: true, kind, tool, result: body };
  try {
    const args = JSON.parse(body) as unknown;
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object');
    return { ok: true, kind, tool, args: args as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'The arguments must be a JSON object, like {"path": "README.md"}.' };
  }
}

function countText(c: Count, verb: string): string | null {
  if (!c) return null;
  return `${verb} ${c[0]} of ${c[1]}`;
}

function pct(p: number): string {
  const v = p * 100;
  return v >= 99.95 ? '>99.9%' : v < 0.1 ? '<0.1%' : `${v.toFixed(1)}%`;
}

function ms(n: number | undefined): string {
  if (n === undefined) return '';
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
}

/** Highlight the attacker's instruction inside the payload text, when we know it. */
function Highlighted({ text, hidden }: { text: string; hidden?: string }) {
  if (!hidden) return <>{text}</>;
  const i = text.indexOf(hidden);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="px-hidden">{hidden}</mark>
      {text.slice(i + hidden.length)}
    </>
  );
}

type Phase = 'idle' | 'rules' | 'model' | 'done';

export function ProtocolXPlayground({ upgradeUrl }: { upgradeUrl: string | null }) {
  const goals = useMemo(
    () => [...PLAYGROUND.goals, { id: 'harmless', label: 'Nothing, a harmless result', line: 'An ordinary tool result in the same disguise, to see whether it gets through.' }],
    [],
  );
  const [goal, setGoal] = useState<GoalId>(PLAYGROUND.goals[0].id);
  const [disguise, setDisguise] = useState<string>(PLAYGROUND.disguises[0].id);
  const [index, setIndex] = useState(0);

  const pool: PlayExample[] = useMemo(() => {
    if (goal === 'harmless') return PLAYGROUND.harmless[disguise]?.examples ?? [];
    return PLAYGROUND.cells[`${goal}:${disguise}`]?.examples ?? [];
  }, [goal, disguise]);
  const example = pool.length ? pool[index % pool.length] : null;

  const [text, setText] = useState(example?.payload ?? '');
  const [editing, setEditing] = useState(false);
  const edited = !!example && text.trim() !== example.payload.trim();
  const [phase, setPhase] = useState<Phase>('idle');
  const [rules, setRules] = useState<{ ok: true; result: RuleCheckResult } | { ok: false; status: number; error: string } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  const reset = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPhase('idle');
    setRules(null);
    setParseError(null);
  };

  useEffect(() => {
    setText(example?.payload ?? '');
    setEditing(false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [example?.id]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const stats = goal === 'harmless'
    ? countText(PLAYGROUND.harmless[disguise]?.wronglyBlocked.now ?? null, 'Wrongly blocked')
    : countText(PLAYGROUND.cells[`${goal}:${disguise}`]?.caught.now ?? null, 'Caught');

  const send = async () => {
    reset();
    const parsed = parsePayload(text);
    if (!parsed.ok) {
      setParseError(parsed.error);
      return;
    }
    setPhase('rules');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const started = performance.now();
    const res = await checkWithLocalRules(
      parsed.kind === 'call'
        ? { kind: 'call', tool: parsed.tool, arguments: parsed.args }
        : { kind: 'result', tool: parsed.tool, result: parsed.result },
    );
    setRules(res);
    // Let the rule step register visually before the model step, then show the recorded model time.
    const wait = reduce ? 0 : Math.max(0, 450 - (performance.now() - started));
    timers.current.push(
      window.setTimeout(() => {
        setPhase('model');
        const modelMs = reduce || edited ? 0 : Math.min(1400, example?.now.ms ?? 900);
        timers.current.push(window.setTimeout(() => setPhase('done'), modelMs));
      }, wait),
    );
  };

  const rulesBlocked = rules?.ok && (rules.result.action === 'block' || rules.result.action === 'redact');
  const pxBlocked = !edited && !!example?.now.blocked;
  const stoppedBy: 'rules' | 'model' | null =
    phase === 'idle' ? null : rulesBlocked ? 'rules' : phase === 'done' && pxBlocked ? 'model' : null;
  const carrier = example?.carrier ?? 'result';
  const from = carrier === 'call' ? 'Agent' : 'Tool';
  const to = carrier === 'call' ? 'Tool' : 'Agent';
  const reached = phase === 'done' && !rulesBlocked && !pxBlocked;

  return (
    <section className="px" aria-labelledby="px-title">
      <div className="px-head">
        <div>
          <h2 id="px-title" className="home-h2">Try to get an attack past Protocol X</h2>
          <p className="home-lede">
            Pick what the attacker wants and how they hide it. Your free rules check it live on this computer; Protocol X,
            the model in Shield, gives the verdict it gave on this exact text in our red-team runs.
          </p>
        </div>
        <dl className="px-facts">
          <div><dt>Novel attacks tested</dt><dd>{PX_RESULTS.novelAttacks}</dd></div>
          <div><dt>AgentDojo attacker success</dt><dd>{PX_RESULTS.agentdojo.before} to {PX_RESULTS.agentdojo.after}</dd></div>
          <div><dt>Ordinary calls allowed</dt><dd>{BENIGN_CHECK.allowed} of {BENIGN_CHECK.scored}</dd></div>
        </dl>
      </div>

      <div className="px-pick">
        <fieldset className="px-choices">
          <legend>The attacker wants to</legend>
          {goals.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`chip${goal === g.id ? ' active' : ''}`}
              aria-pressed={goal === g.id}
              onClick={() => { setGoal(g.id); setIndex(0); }}
              title={g.line}
            >
              {g.label}
            </button>
          ))}
        </fieldset>
        <fieldset className="px-choices">
          <legend>Hidden by</legend>
          {PLAYGROUND.disguises.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`chip${disguise === d.id ? ' active' : ''}`}
              aria-pressed={disguise === d.id}
              onClick={() => { setDisguise(d.id); setIndex(0); }}
              title={d.line}
            >
              {d.label}
            </button>
          ))}
        </fieldset>
        <p className="px-explain">
          {goals.find((g) => g.id === goal)?.line} {PLAYGROUND.disguises.find((d) => d.id === disguise)?.line}
        </p>
      </div>

      <div className="px-stage">
        <div className="px-payload">
          <div className="px-payload-bar">
            <span>
              {carrier === 'call' ? 'Tool call from the agent' : 'Tool result on its way to the agent'}
              {example && <span className="px-src"> · red-team item {example.id}</span>}
            </span>
            <span className="px-payload-actions">
              {editing ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setText(example?.payload ?? ''); setEditing(false); reset(); }}
                >
                  <RotateCcw size={13} aria-hidden="true" /> Back to the recorded text
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                  <PencilLine size={13} aria-hidden="true" /> Edit the text
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setIndex((i) => i + 1)}
                disabled={pool.length < 2}
                title={`${pool.length} recorded examples in this combination`}
              >
                <Shuffle size={13} aria-hidden="true" /> Another example
              </button>
            </span>
          </div>
          {editing ? (
            <textarea
              className="px-text"
              value={text}
              onChange={(e) => { setText(e.target.value); reset(); }}
              spellCheck={false}
              aria-label="Payload"
              rows={8}
              autoFocus
            />
          ) : (
            <pre className="px-text px-text-view" aria-label="Payload">
              <Highlighted text={text} hidden={example?.hidden} />
            </pre>
          )}
          <div className="px-payload-foot">
            {example?.hidden && !editing && <span><mark className="px-hidden">Highlighted</mark> is the attacker’s instruction.</span>}
            {editing && !edited && <span>Change anything, then send it. Your rules check it live.</span>}
            {edited && <span>Your edit has no recorded Protocol X run. Your rules still check it live.</span>}
          </div>
          {parseError && <p className="px-error" role="alert">{parseError}</p>}
          <button type="button" className="btn btn-primary px-send" onClick={() => void send()} disabled={phase === 'rules' || phase === 'model'}>
            {phase === 'rules' || phase === 'model' ? 'Checking' : phase === 'done' ? 'Send it again' : 'Send it through Mastyf'}
          </button>
        </div>

        <div className="px-verdicts" aria-live="polite">
          <ol className={`px-track${phase !== 'idle' ? ' running' : ''}${stoppedBy ? ` stopped-${stoppedBy}` : ''}${reached ? ' reached' : ''}`} aria-label="Path of the payload">
            <li className="px-node">{from}</li>
            <li className={`px-node gate${phase !== 'idle' ? ' visited' : ''}${stoppedBy === 'rules' ? ' stop' : ''}`}>Your rules</li>
            <li className={`px-node gate${phase === 'model' || phase === 'done' ? ' visited' : ''}${stoppedBy === 'model' ? ' stop' : ''}${edited ? ' locked' : ''}`}>Protocol X</li>
            <li className={`px-node${reached ? ' visited' : ''}`}>{to}</li>
          </ol>

          <div className={`verdict${phase === 'idle' ? ' waiting' : ''}`}>
            <div className="verdict-head">
              <span className="verdict-name">Your rules</span>
              <span className="verdict-tag">Free, live on this computer</span>
            </div>
            {phase === 'idle' && <p className="verdict-wait">Waiting for you to send it.</p>}
            {phase !== 'idle' && !rules && <p className="verdict-wait">Checking against your policy</p>}
            {rules && !rules.ok && (
              <p className="verdict-wait">
                {rules.status === 403
                  ? 'Your role can look but not run rule checks. An operator or administrator can.'
                  : `The rule check did not run: ${rules.error}`}
              </p>
            )}
            {rules?.ok && (
              <div className="verdict-body">
                <span className={`verdict-result ${rulesBlocked ? 'block' : 'allow'}`}>
                  {rules.result.action === 'redact' ? 'Redacted' : rulesBlocked ? 'Blocked' : 'Let through'}
                </span>
                <span className="verdict-detail">
                  {rulesBlocked ? <code>{rules.result.rule}</code> : null} {rules.result.reason}
                </span>
                {rules.result.elapsedMs !== undefined && <span className="verdict-time">{ms(rules.result.elapsedMs)}</span>}
              </div>
            )}
          </div>

          <div className={`verdict model${phase === 'idle' || phase === 'rules' ? ' waiting' : ''}`}>
            <div className="verdict-head">
              <span className="verdict-name">Protocol X</span>
              <span className="verdict-tag">{edited ? 'In Shield' : `Recorded, ${PLAYGROUND.releases.now}`}</span>
            </div>
            {edited ? (
              <div className="verdict-locked">
                <p>Protocol X reads text it has never seen when it runs inside Shield. In this preview it can only show recorded runs.</p>
                {upgradeUrl && <a className="btn btn-sm" href={upgradeUrl} target="_blank" rel="noopener noreferrer">See Shield plans</a>}
              </div>
            ) : phase === 'idle' || phase === 'rules' ? (
              <p className="verdict-wait">{phase === 'rules' ? 'Next' : 'Waiting for you to send it.'}</p>
            ) : phase === 'model' ? (
              <p className="verdict-wait">Reading it in context</p>
            ) : example ? (
              <div className="verdict-body">
                <span className={`verdict-result ${pxBlocked ? 'block' : 'allow'}`}>{pxBlocked ? 'Blocked' : 'Let through'}</span>
                <span className="verdict-detail">
                  Chance this is an attack: <strong>{pct(example.now.p)}</strong>
                  {example.before && <> (previous release: {pct(example.before.p)})</>}
                </span>
                <span className="px-meter" aria-hidden="true">
                  <span
                    className={example.now.p >= 0.5 ? 'hi' : example.now.p >= 0.1 ? 'mid' : 'lo'}
                    style={{ width: `${Math.max(1, example.now.p * 100)}%` }}
                  />
                </span>
                {example.now.ms !== undefined && <span className="verdict-time">{ms(example.now.ms)} on a laptop CPU</span>}
              </div>
            ) : null}
          </div>

          {phase === 'done' && (
            <p className="px-outcome">
              {rulesBlocked && pxBlocked && 'Both stopped it. Your rules matched a known pattern; Protocol X read the intent.'}
              {rulesBlocked && !pxBlocked && !edited && (goal === 'harmless'
                ? 'Your rules blocked a harmless result. Protocol X let it through, because it reads what the text means rather than matching patterns.'
                : 'Your rules stopped it before it reached Protocol X.')}
              {!rulesBlocked && pxBlocked && 'Your rules let this through. Protocol X caught it. This is the gap Shield closes.'}
              {!rulesBlocked && !pxBlocked && !edited && (goal === 'harmless' ? 'Both let a harmless result through, as they should.' : 'This one got past both.')}
              {!rulesBlocked && edited && 'Your rules let your edit through. In Shield, Protocol X would read it next.'}
              {rulesBlocked && edited && 'Your rules stopped your edit.'}
            </p>
          )}
          {stats && (
            <p className="px-stat">
              {stats} {goal === 'harmless' ? 'harmless results' : 'attacks'} in this disguise in our red-team suite ({PLAYGROUND.releases.now}).
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

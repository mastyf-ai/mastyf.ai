'use client';

import { useEffect, useState } from 'react';
import { REPLAY_SCENARIOS, type ReplayLine } from '@/lib/protocol-x/attack-stories';
import { checkWithLocalRules, type RuleCheckResult } from '@/lib/mastyf-ai-api';
import { parsePayload } from './ProtocolXPlayground';

/**
 * Which Shield layer stops each example, and why. The stories are the illustrative ones from
 * mastyf.ai; the last call in each is checked live against this install's own rules.
 */
const LAYERS: Record<string, Array<{ name: string; why: string }>> = {
  web: [
    { name: 'DIFC taint tracking', why: 'The secret is being sent to an address that came from a web page. Data marked untrusted cannot flow out.' },
    { name: 'Causal gate', why: 'The upload was set off by text on the page, not by your request to summarize it.' },
    { name: 'Argument-intent auditor', why: 'You asked for notes. A POST of AWS_SECRET to another host does not match that.' },
  ],
  config: [
    { name: 'Argument-intent auditor', why: 'You asked to debug app.yaml. Reading ../../.env is outside what that task needs.' },
    { name: 'Causal gate', why: 'The read was triggered by a comment inside the file, not by you.' },
  ],
  test: [
    { name: 'Causal gate', why: 'The shell command came from a line in the README, not from your request to fix a test.' },
    { name: 'Protocol X', why: 'Reads the call in context and recognises an interactive reverse shell.' },
  ],
  normal: [{ name: 'Every layer', why: 'An ordinary read of the last commit. Nothing to stop, so it runs.' }],
};

/** "network.http_post({...})" or "filesystem.read_file({...})" → tool name and arguments. */
function callFromLine(line: string): { tool: string; args: Record<string, unknown> } | null {
  const m = line.match(/^([\w.]+)\((\{[\s\S]*\})\)\s*$/);
  if (!m) return null;
  const parsed = parsePayload(`MCP tool call\nTool: ${m[1].split('.').pop()}\nArguments: ${m[2]}`);
  return parsed.ok && parsed.kind === 'call' ? { tool: parsed.tool, args: parsed.args } : null;
}

function Line({ l }: { l: ReplayLine }) {
  return <li className={`story-line ${l.kind}`}>{l.text}</li>;
}

export function ShieldLayers({ upgradeUrl }: { upgradeUrl: string | null }) {
  const [id, setId] = useState(REPLAY_SCENARIOS[0].id);
  const scenario = REPLAY_SCENARIOS.find((s) => s.id === id) ?? REPLAY_SCENARIOS[0];
  const finalCall = [...scenario.steps].reverse().find((s) => s.kind === 'call');
  const parsed = finalCall ? callFromLine(finalCall.text) : null;
  const [rules, setRules] = useState<{ ok: true; result: RuleCheckResult } | { ok: false; status: number; error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRules(null);
    if (!parsed) return;
    void checkWithLocalRules({ kind: 'call', tool: parsed.tool, arguments: parsed.args }).then((r) => {
      if (!cancelled) setRules(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const blocked = rules?.ok && (rules.result.action === 'block' || rules.result.action === 'redact');

  return (
    <section className="layers" aria-labelledby="layers-title">
      <div className="layers-head">
        <h2 id="layers-title" className="home-h2">What Shield adds to your rules</h2>
        <p className="home-lede">
          Rules match patterns. Shield also tracks where data came from and what you actually asked for. Pick an everyday task
          to see an attack ride along with it.
        </p>
      </div>
      <div className="seg" role="tablist" aria-label="Example task">
        {REPLAY_SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === id}
            className={`seg-item${s.id === id ? ' active' : ''}`}
            onClick={() => setId(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="layers-body">
        <div className="story">
          <p className="story-label">What happens</p>
          <ol className="story-lines">
            {scenario.steps.map((l, i) => <Line key={i} l={l} />)}
          </ol>
          <p className="story-note">An illustrative example, the same one shown on mastyf.ai.</p>
        </div>

        <div className="layers-verdicts">
          <div className="layer-row live">
            <div className="layer-name">
              Your rules <span className="verdict-tag">Live, on this call</span>
            </div>
            {!parsed && <p className="muted">This step has no tool call to check.</p>}
            {parsed && !rules && <p className="muted">Checking</p>}
            {rules && !rules.ok && (
              <p className="muted">{rules.status === 403 ? 'Your role cannot run rule checks.' : `Check did not run: ${rules.error}`}</p>
            )}
            {rules?.ok && (
              <p>
                <span className={`verdict-result ${blocked ? 'block' : 'allow'}`}>{blocked ? 'Blocked' : 'Let through'}</span>{' '}
                <span className="verdict-detail">{rules.result.reason}</span>
              </p>
            )}
          </div>
          {(LAYERS[scenario.id] ?? []).map((layer) => (
            <div key={layer.name} className="layer-row">
              <div className="layer-name">
                {layer.name} <span className="verdict-tag">Shield</span>
              </div>
              <p>{layer.why}</p>
            </div>
          ))}
          {scenario.id !== 'normal' && upgradeUrl && (
            <a className="btn btn-sm layers-cta" href={upgradeUrl} target="_blank" rel="noopener noreferrer">
              Compare plans
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

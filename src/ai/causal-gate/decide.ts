/**
 * Combines the evidence on one tool call into a decision that can explain itself. Reads always pass,
 * and a risky action is stopped when a target only ever appeared in attacker-writable data.
 */
import type { Effect } from './effect.js';
import type { OriginMatch } from './ledger.js';

export type GateAction = 'allow' | 'block' | 'hold';

export interface GateInput {
  tool: string;
  effect: Effect;
  sensitive: string[];
  /** Arguments where only a link or an address counts, such as the body of a message. */
  messages?: string[];
  matches: OriginMatch[];
  /** Comparable values per argument path. Only needed with the two flags below. */
  values?: Map<string, string[]>;
  argsTruncated?: boolean;
  ledgerIncomplete?: boolean;
  /** A read that sends data out: a query added to a URL only attacker-written text pointed at. */
  exfilUrl?: string;
}

export interface GateDecision {
  action: GateAction;
  rule: string;
  evidence: OriginMatch[];
  message: string;
}

const MAX_VALUE_IN_MESSAGE = 60;
const LINK_KINDS = new Set(['url', 'domain', 'email']);

function describe(match: OriginMatch): string {
  const value = match.value.length > MAX_VALUE_IN_MESSAGE ? `${match.value.slice(0, MAX_VALUE_IN_MESSAGE)}...` : match.value;
  const where = match.sources.map((s) => `"${s.fieldPath}" of ${s.tool}`).join(', ');
  if (match.built) return `argument "${match.argPath}" uses "${value}", which is put together from what only appeared in ${where}`;
  return `argument "${match.argPath}" uses "${value}", which only appeared in ${where}`;
}

export function decide(input: GateInput): GateDecision {
  const { tool, effect, sensitive, matches } = input;
  const allow = (rule: string, message: string): GateDecision => ({ action: 'allow', rule, evidence: [], message });

  if (input.exfilUrl) {
    return {
      action: 'hold',
      rule: 'causal-exfil-url',
      evidence: [],
      message: `${tool}: "${input.exfilUrl.slice(0, MAX_VALUE_IN_MESSAGE)}" adds a query to an address that only appeared in data the agent read`,
    };
  }

  if (effect === 'read') return allow('causal-read-pass', `${tool} only reads`);

  const wanted = new Set(sensitive);
  const messages = new Set(input.messages);
  // A copied sentence is evidence where any text can run or grant something. Elsewhere, a name, address
  // or time is often written the way it was read, and what matters is the target.
  const phrasesCount = effect === 'irreversible' || effect === 'privilege';
  const counts = (m: OriginMatch) =>
    wanted.has(m.argPath)
      ? m.kind !== 'phrase' || phrasesCount
      : messages.has(m.argPath) && !!m.kind && LINK_KINDS.has(m.kind);
  const tainted = matches.filter(
    (m) => counts(m) && m.sources.length > 0 && m.sources.every((s) => s.origin === 'attacker_writable'),
  );
  if (tainted.length > 0) {
    return {
      action: 'hold',
      rule: 'causal-origin',
      evidence: tainted,
      message: `${tool}: ${tainted.map(describe).join('; ')}`,
    };
  }

  if (input.argsTruncated) {
    return {
      action: 'hold',
      rule: 'causal-unverifiable',
      evidence: [],
      message: `${tool}: arguments are too large or deeply nested to check`,
    };
  }

  // Part of what the agent read went unchecked, so a target never seen before could have come from it.
  if (input.ledgerIncomplete) {
    const vouched = new Set(
      matches.filter((m) => m.sources.some((s) => s.origin !== 'attacker_writable')).map((m) => m.value),
    );
    for (const path of sensitive) {
      const unknown = input.values?.get(path)?.find((value) => !vouched.has(value));
      if (unknown !== undefined) {
        return {
          action: 'hold',
          rule: 'causal-unverifiable',
          evidence: [],
          message: `${tool}: argument "${path}" could not be checked, because earlier tool results were too large to read in full`,
        };
      }
    }
  }

  return allow('causal-no-evidence', `no evidence against this ${tool} call`);
}

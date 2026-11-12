import type { Direction } from './data';

/** One recorded verdict: blocked or not, the model's probability of "attack", and the time it took. */
export type RecordedVerdict = { blocked: boolean; p: number; ms?: number };

export type PlayExample = {
  id: string;
  carrier: Direction;
  tool: string;
  payload: string;
  /** The attacker's instruction inside the payload; absent for harmless examples. */
  hidden?: string;
  now: RecordedVerdict;
  /** The previous release's verdict on the same text, or null when it was not scored. */
  before: RecordedVerdict | null;
};

/** [caught or wrongly blocked, out of]; null when that release was not scored on these items. */
export type Count = [number, number] | null;

export type PlayChoice = { id: string; label: string; line: string };

export type PlaygroundData = {
  releases: { before: string; now: string };
  /** Every attack and harmless twin in each disguise, by release. */
  families: Record<string, { caught: { now: Count; before: Count }; wronglyBlocked: { now: Count; before: Count } }>;
  goals: PlayChoice[];
  disguises: PlayChoice[];
  cells: Record<string, { caught: { now: Count; before: Count }; examples: PlayExample[] }>;
  harmless: Record<string, { wronglyBlocked: { now: Count; before: Count }; examples: PlayExample[] }>;
};

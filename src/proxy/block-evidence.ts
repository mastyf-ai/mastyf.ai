/**
 * What a block was based on: the layer that stopped the call, and, when that layer matched literal
 * text, the text and the argument it was in. Layers that judge a whole call record no matched text,
 * so none is ever shown for them.
 */

export const BLOCK_LAYERS = [
  'injection-scan',
  'policy',
  'secret-scan',
  'answer-check',
  'attack-chain',
  'session',
  'hooks',
  'size-limit',
  'lifecycle',
] as const;

export type BlockLayer = (typeof BLOCK_LAYERS)[number];

export interface BlockEvidence {
  layer: BlockLayer;
  /** The text the check matched, clipped. Never a secret's value. */
  match?: string;
  /** The argument the text was in. */
  field?: string;
  /** 0 to 1, when the check gave one. */
  confidence?: number;
}

export type DefencePhase = 'lifecycle' | 'pre-guard' | 'hooks' | 'policy' | 'semantic' | 'spend';

const PHASE_LAYER: Record<DefencePhase, BlockLayer> = {
  lifecycle: 'lifecycle',
  'pre-guard': 'injection-scan',
  hooks: 'hooks',
  policy: 'policy',
  semantic: 'policy',
  spend: 'policy',
};

export function layerForPhase(phase: DefencePhase): BlockLayer {
  return PHASE_LAYER[phase];
}

/** The text a pattern matched in `text`, or undefined. Safe for global patterns. */
export function matchOf(pattern: RegExp, text: string): string | undefined {
  const re = new RegExp(pattern.source, pattern.flags.replace('g', '').replace('y', ''));
  const found = re.exec(text);
  return found ? found[0] : undefined;
}

/** Whitespace collapsed and capped, so a matched phrase reads on one line. */
export function clipMatch(text: string | undefined | null, max = 160): string | undefined {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

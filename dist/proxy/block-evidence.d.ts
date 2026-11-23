/**
 * What a block was based on: the layer that stopped the call, and, when that layer matched literal
 * text, the text and the argument it was in. Layers that judge a whole call record no matched text,
 * so none is ever shown for them.
 */
export declare const BLOCK_LAYERS: readonly ["injection-scan", "policy", "secret-scan", "answer-check", "attack-chain", "session", "hooks", "size-limit", "lifecycle"];
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
export declare function layerForPhase(phase: DefencePhase): BlockLayer;
/** The text a pattern matched in `text`, or undefined. Safe for global patterns. */
export declare function matchOf(pattern: RegExp, text: string): string | undefined;
/** Whitespace collapsed and capped, so a matched phrase reads on one line. */
export declare function clipMatch(text: string | undefined | null, max?: number): string | undefined;
//# sourceMappingURL=block-evidence.d.ts.map
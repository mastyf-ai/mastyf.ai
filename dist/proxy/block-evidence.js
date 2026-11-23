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
];
const PHASE_LAYER = {
    lifecycle: 'lifecycle',
    'pre-guard': 'injection-scan',
    hooks: 'hooks',
    policy: 'policy',
    semantic: 'policy',
    spend: 'policy',
};
export function layerForPhase(phase) {
    return PHASE_LAYER[phase];
}
/** The text a pattern matched in `text`, or undefined. Safe for global patterns. */
export function matchOf(pattern, text) {
    const re = new RegExp(pattern.source, pattern.flags.replace('g', '').replace('y', ''));
    const found = re.exec(text);
    return found ? found[0] : undefined;
}
/** Whitespace collapsed and capped, so a matched phrase reads on one line. */
export function clipMatch(text, max = 160) {
    const flat = (text ?? '').replace(/\s+/g, ' ').trim();
    if (!flat)
        return undefined;
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
//# sourceMappingURL=block-evidence.js.map
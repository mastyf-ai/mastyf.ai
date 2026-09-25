import { getFlowHistorySync } from './session-flow-store.js';
import { flowSessionKey } from './session-flow-guard.js';
const SIMILARITY_THRESHOLD = () => {
    const n = parseFloat(process.env['MASTYF_AI_LOOP_SIMILARITY_THRESHOLD'] || '0.82');
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.82;
};
const BURST_WINDOW_MS = () => {
    const n = parseInt(process.env['MASTYF_AI_LOOP_BURST_WINDOW_MS'] || '10000', 10);
    return Number.isFinite(n) && n > 0 ? n : 10_000;
};
const BURST_MAX_SIMILAR = () => {
    const n = parseInt(process.env['MASTYF_AI_LOOP_BURST_MAX_SIMILAR'] || '8', 10);
    return Number.isFinite(n) && n > 0 ? n : 8;
};
const LOOP_TOKENS_PER_MIN = () => {
    const n = parseInt(process.env['MASTYF_AI_LOOP_TOKENS_PER_MIN'] || '200000', 10);
    return Number.isFinite(n) && n > 0 ? n : 200_000;
};
function tokensInLastMinute(history, now) {
    return history
        .filter((e) => now - e.at <= 60_000)
        .reduce((sum, e) => sum + (e.tokens ?? 0), 0);
}
function normalizePayload(value) {
    if (value == null)
        return '';
    if (typeof value === 'string')
        return value.toLowerCase().replace(/\s+/g, ' ').trim();
    try {
        return JSON.stringify(value).toLowerCase().replace(/\s+/g, ' ').trim();
    }
    catch {
        return String(value).toLowerCase();
    }
}
function tokenSet(text) {
    return new Set(text.split(/[^a-z0-9]+/i).filter((t) => t.length >= 2));
}
/** Jaccard similarity on token sets (robust to small perturbations). */
export function payloadSimilarity(a, b) {
    if (!a || !b)
        return 0;
    if (a === b)
        return 1;
    const sa = tokenSet(a);
    const sb = tokenSet(b);
    if (sa.size === 0 || sb.size === 0)
        return 0;
    let inter = 0;
    for (const t of sa) {
        if (sb.has(t))
            inter++;
    }
    const union = sa.size + sb.size - inter;
    return union > 0 ? inter / union : 0;
}
export function fingerprintArguments(args) {
    return normalizePayload(args ?? {});
}
export function evaluateLoopAnomalyGuard(ctx) {
    const sessionKey = flowSessionKey(ctx);
    const history = getFlowHistorySync(sessionKey);
    const currentFp = fingerprintArguments(ctx.arguments);
    if (!currentFp)
        return null;
    const now = Date.now();
    const threshold = SIMILARITY_THRESHOLD();
    let similarRecent = 0;
    for (const event of history) {
        if (now - event.at > BURST_WINDOW_MS())
            continue;
        const priorFp = event.argFingerprint || fingerprintArguments(event.argumentsSnapshot);
        if (payloadSimilarity(currentFp, priorFp) >= threshold) {
            similarRecent++;
        }
    }
    const recentCalls = history.filter((e) => now - e.at <= 60_000);
    const tokensPerMin = tokensInLastMinute(history, now) + (ctx.requestTokens ?? 0);
    // A single oversized request is token-budget's job. Loop burn needs a multi-call window.
    if (recentCalls.length >= 3 && tokensPerMin >= LOOP_TOKENS_PER_MIN()) {
        return {
            action: 'block',
            rule: 'loop-anomaly-perturbation',
            reason: `Loop token burn rate exceeded (${tokensPerMin} tokens/min, cap ${LOOP_TOKENS_PER_MIN()})`,
        };
    }
    if (similarRecent >= BURST_MAX_SIMILAR()) {
        return {
            action: 'block',
            rule: 'loop-anomaly-perturbation',
            reason: `High-frequency semantically similar tool calls (${similarRecent + 1} in ${BURST_WINDOW_MS()}ms window)`,
        };
    }
    return null;
}
//# sourceMappingURL=loop-anomaly-detector.js.map
/**
 * Shared token estimate derived from tool-call arguments.
 *
 * ## Why this is its own module
 *
 * Two call sites need the same number and must not disagree:
 *
 *  - `PolicyEngine.effectiveRequestTokens`, which applies it as a *floor* over
 *    whatever the transport reported.
 *  - The Agent Gateway authorizer, which has no transport-reported count at all
 *    and would otherwise report zero.
 *
 * When the gateway carried a private copy of this logic it drifted, and the
 * consequence was invisible: the engine's `maxTokens` rules kept working (they
 * go through the floor) while four consumers that read `ctx.requestTokens`
 * directly -- `loop-anomaly-detector`, `token-budget-strategy-legacy`,
 * `session-flow-guard`, and `user-tool-enforcement` -- plus the post-policy
 * spend reservation in `proxy-post-allow-gates` all saw zero. That is what a
 * duplicated estimator actually costs, and it is why there is exactly one.
 *
 * ## This is an estimate, not a measurement
 *
 * It is a guard input, not an accounting input. It is deliberately never used
 * for billing: cost auditing reads real tokenizer counts from proxy records
 * (`cost-auditor.ts`), and a request authorized at the gateway produces no such
 * record. Callers that persist this number must label it as an estimate.
 */
import { walkStringLeaves } from './arg-leaf-walker.js';
/**
 * Characters in a single field above which the value is treated as context
 * stuffing. A large blob can sit well under the byte/4 estimate while still
 * being the attack this guard exists to catch.
 */
const STUFFING_CHAR_THRESHOLD = 40_000;
/**
 * Estimates tokens from the argument payload alone.
 *
 * Three independent estimates are combined because each misses a different
 * evasion: byte length under-counts non-ASCII, character count under-counts
 * dense ASCII, and both under-count a single stuffed field.
 */
export function estimateArgumentTokens(args) {
    let inflated = 0;
    let leafChars = 0;
    if (args !== undefined && args !== null) {
        for (const { value } of walkStringLeaves(args)) {
            leafChars += value.length;
            inflated += Buffer.byteLength(value, 'utf8');
            for (const ch of value) {
                const cp = ch.codePointAt(0);
                // Non-ASCII is billed at more than one byte per token on common
                // vocabularies; inflating here keeps the estimate conservative.
                if (cp > 0x7f)
                    inflated += 2;
            }
        }
    }
    const byteEstimate = Math.ceil(inflated / 4);
    const charEstimate = Math.ceil(leafChars / 2);
    const stuffingEstimate = leafChars >= STUFFING_CHAR_THRESHOLD ? leafChars : 0;
    return Math.max(byteEstimate, charEstimate, stuffingEstimate);
}
//# sourceMappingURL=estimate-argument-tokens.js.map
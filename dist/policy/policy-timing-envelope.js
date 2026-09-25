/**
 * Policy evaluation timing envelope — normalizes wall-clock latency so pass vs block
 * decisions do not leak via measurable timing differences (within Mastyf AI's boundary).
 */
import { envInt } from '../utils/eval-bounds.js';
export function isPolicyTimingEnvelopeEnabled() {
    return process.env['MASTYF_AI_POLICY_TIMING_ENVELOPE'] !== 'false';
}
export function policyMinEvalMs() {
    return envInt('MASTYF_AI_POLICY_MIN_EVAL_MS', 25);
}
export function proxyTimingNormalizeMs() {
    return envInt('MASTYF_AI_PROXY_TIMING_NORMALIZE_MS', 15);
}
/** Synchronous minimum duration (used by harness sync evaluate). */
export function waitPolicyTimingEnvelopeSync(startedAt) {
    if (!isPolicyTimingEnvelopeEnabled())
        return;
    const minMs = policyMinEvalMs();
    const deadline = startedAt + minMs;
    while (Date.now() < deadline) {
        /* intentional spin — bounds policy path timing leakage */
    }
}
/** Async minimum duration (production proxy evaluateAsync). */
export async function waitPolicyTimingEnvelopeAsync(startedAt) {
    if (!isPolicyTimingEnvelopeEnabled())
        return;
    const minMs = policyMinEvalMs();
    const elapsed = Date.now() - startedAt;
    if (elapsed < minMs) {
        await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
    }
}
/** Optional extra delay on tools/call to reduce request-path timing oracle. */
export async function waitProxyTimingNormalize(startedAt) {
    if (process.env['MASTYF_AI_PROXY_TIMING_NORMALIZE'] === 'false')
        return;
    const minMs = proxyTimingNormalizeMs();
    const elapsed = Date.now() - startedAt;
    if (elapsed < minMs) {
        await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
    }
}
//# sourceMappingURL=policy-timing-envelope.js.map
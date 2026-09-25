/**
 * Process-wide rate limit counters — survive PolicyEngine hot-reload swaps.
 */
import { LRUCache } from 'lru-cache';
let callCounters = null;
let burstCounters = null;
function getCallCounters() {
    if (!callCounters) {
        callCounters = new LRUCache({
            max: 50_000,
            ttl: 60_000,
            updateAgeOnGet: false,
        });
    }
    return callCounters;
}
function getBurstCounters() {
    if (!burstCounters) {
        burstCounters = new LRUCache({
            max: 50_000,
            ttl: 10_000,
            updateAgeOnGet: false,
        });
    }
    return burstCounters;
}
export const sharedRateLimitStore = {
    call: getCallCounters,
    burst: getBurstCounters,
    resetForTests() {
        callCounters = null;
        burstCounters = null;
    },
};
//# sourceMappingURL=rate-limit-store.js.map
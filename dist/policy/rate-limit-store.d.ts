/**
 * Process-wide rate limit counters — survive PolicyEngine hot-reload swaps.
 */
import { LRUCache } from 'lru-cache';
export type RateCounter = {
    count: number;
    resetAt: number;
};
declare function getCallCounters(): LRUCache<string, RateCounter>;
declare function getBurstCounters(): LRUCache<string, RateCounter>;
export declare const sharedRateLimitStore: {
    call: typeof getCallCounters;
    burst: typeof getBurstCounters;
    resetForTests(): void;
};
export {};
//# sourceMappingURL=rate-limit-store.d.ts.map
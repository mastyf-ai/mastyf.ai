interface RateLimiterOptions {
    tokensPerInterval: number;
    interval: number;
}
export declare class RateLimiter {
    private tokens;
    private lastRefill;
    private tokensPerInterval;
    private interval;
    constructor(opts: RateLimiterOptions);
    tryAcquire(): boolean;
    /** Block until a token is available (async-compatible). */
    acquire(): Promise<void>;
    msUntilNextToken(): number;
    private refill;
}
export {};
//# sourceMappingURL=rate-limiter.d.ts.map
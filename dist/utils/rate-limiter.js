export class RateLimiter {
    tokens;
    lastRefill;
    tokensPerInterval;
    interval;
    constructor(opts) {
        this.tokensPerInterval = opts.tokensPerInterval;
        this.interval = opts.interval;
        this.tokens = opts.tokensPerInterval;
        this.lastRefill = Date.now();
    }
    tryAcquire() {
        this.refill();
        if (this.tokens > 0) {
            this.tokens--;
            return true;
        }
        return false;
    }
    /** Block until a token is available (async-compatible). */
    async acquire() {
        while (!this.tryAcquire()) {
            await new Promise(r => setTimeout(r, this.msUntilNextToken()));
        }
    }
    msUntilNextToken() {
        this.refill();
        if (this.tokens > 0)
            return 0;
        return this.interval - (Date.now() - this.lastRefill);
    }
    refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        if (elapsed >= this.interval) {
            this.tokens = this.tokensPerInterval;
            this.lastRefill = now;
        }
    }
}
//# sourceMappingURL=rate-limiter.js.map
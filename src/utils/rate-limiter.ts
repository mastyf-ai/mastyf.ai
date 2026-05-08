/**
 * Token-bucket rate limiter for external API calls.
 * Prevents exceeding API rate limits for OSV.dev, NVD, etc.
 */
export class RateLimiter {
  private maxTokens: number;
  private intervalMs: number;
  private tokens: number;
  private lastRefill: number;
  private queue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private processing = false;

  constructor(maxPerInterval: number, intervalMs: number) {
    this.maxTokens = maxPerInterval;
    this.intervalMs = intervalMs;
    this.tokens = maxPerInterval;
    this.lastRefill = Date.now();
  }

  /**
   * Wait until a token is available, then consume it.
   * Returns immediately if a token is available.
   */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }

    // Queue the request
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refillIntervals = Math.floor(elapsed / this.intervalMs);

    if (refillIntervals > 0) {
      this.tokens = Math.min(
        this.maxTokens,
        this.tokens + refillIntervals * this.maxTokens
      );
      this.lastRefill += refillIntervals * this.intervalMs;
    }
  }

  private processQueue(): void {
    this.processing = true;
    const interval = setInterval(() => {
      this.refill();
      while (this.tokens > 0 && this.queue.length > 0) {
        const req = this.queue.shift()!;
        this.tokens--;
        req.resolve();
      }
      if (this.queue.length === 0) {
        clearInterval(interval);
        this.processing = false;
      }
    }, Math.max(this.intervalMs / this.maxTokens, 50));
  }

  /**
   * Get current available tokens (for debugging).
   */
  get availableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * Pre-configured rate limiters for external APIs.
 */
export const osvLimiter = new RateLimiter(50, 1000);   // 50 req/s (OSV.dev allows burst)
export const nvdLimiter = new RateLimiter(5, 60000);    // 5 req/min (NVD without API key)
export const nvdApiKeyLimiter = new RateLimiter(20, 60000); // 20 req/min (NVD with API key)
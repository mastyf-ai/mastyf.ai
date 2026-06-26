import { describe, expect, it, vi, afterEach } from 'vitest';
import { resetRedisRateLimiterForTests } from '../../src/utils/redis-rate-limiter.js';

vi.mock('../../src/utils/redis-client.js', () => ({
  isRedisConfigured: () => true,
  getRedisConnectionLabel: () => 'mock',
  createRedisClient: () => ({
    incrby: vi.fn(async () => 1),
    pexpire: vi.fn(async () => 1),
    quit: vi.fn(async () => 'OK'),
  }),
}));

import { checkIngressRateLimit } from '../../src/proxy/ingress-rate-limit.js';

describe('ingress rate limit', () => {
  afterEach(() => {
    resetRedisRateLimiterForTests();
    delete process.env.MASTYF_AI_INGRESS_RATE_LIMIT_MAX;
    delete process.env.MASTYF_AI_GLOBAL_RATE_LIMIT_REQUIRED;
  });

  it('allows when ingress limit unset', async () => {
    const result = await checkIngressRateLimit('default');
    expect(result.allowed).toBe(true);
  });
});

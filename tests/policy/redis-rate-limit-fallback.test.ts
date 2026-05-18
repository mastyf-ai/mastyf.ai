import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CallContext, PolicyConfig } from '../../src/policy/policy-types.js';

vi.mock('../../src/utils/redis-client.js', () => ({
  isRedisConfigured: () => true,
}));

vi.mock('../../src/utils/redis-rate-limiter.js', () => ({
  getSharedRedisRateLimiter: () => {
    throw new Error('Redis unavailable');
  },
}));

const rateLimitPolicy: PolicyConfig = {
  policy: {
    mode: 'block',
    rules: [
      {
        name: 'rate-test',
        action: 'block',
        maxCallsPerMinute: 2,
      },
    ],
    default_action: 'pass',
  },
};

function ctx(n: number): CallContext {
  return {
    serverName: 'test',
    toolName: 'read_file',
    arguments: { path: `/tmp/f${n}.txt` },
    requestId: `req-${n}`,
    requestTokens: 10,
    timestamp: new Date().toISOString(),
    agentIdentity: { sub: 'agent-1', clientId: 'client-a' },
  };
}

describe('Redis rate limit fallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to in-process rate limiter when Redis is unavailable', async () => {
    const { PolicyEngine } = await import('../../src/policy/policy-engine.js');
    const engine = new PolicyEngine(rateLimitPolicy);

    const d1 = await engine.evaluateAsync(ctx(1));
    const d2 = await engine.evaluateAsync(ctx(2));
    const d3 = await engine.evaluateAsync(ctx(3));

    expect(d1.action).toBe('pass');
    expect(d2.action).toBe('pass');
    expect(d3.action).toBe('block');
    expect(d3.rule).toBe('rate-test');
  });
});

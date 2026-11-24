import { describe, expect, it } from 'vitest';
import { createAttemptLimiter } from '../../src/auth/attempt-limiter.js';

function run(limiter: ReturnType<typeof createAttemptLimiter>, ip: string) {
  let status = 200;
  let passed = false;
  const res = {
    setHeader: () => undefined,
    status(code: number) { status = code; return this; },
    json: () => undefined,
  };
  limiter({ ip } as never, res as never, () => { passed = true; });
  return passed ? 200 : status;
}

describe('createAttemptLimiter', () => {
  it('allows the limit, refuses the next, and lets the address try again after the window', () => {
    let t = 0;
    const limiter = createAttemptLimiter({ max: 3, windowMs: 1000, now: () => t });
    expect([run(limiter, 'a'), run(limiter, 'a'), run(limiter, 'a')]).toEqual([200, 200, 200]);
    expect(run(limiter, 'a')).toBe(429);
    expect(run(limiter, 'b')).toBe(200);
    t = 1001;
    expect(run(limiter, 'a')).toBe(200);
  });
});

import { describe, it, expect } from 'vitest';
import { shouldCachePolicyDecision } from '../../src/policy/policy-eval-cache.js';

describe('shouldCachePolicyDecision', () => {
  it('rejects rate-limit decisions', () => {
    expect(
      shouldCachePolicyDecision({
        action: 'block',
        rule: 'rate-limit',
        reason: 'Rate limit exceeded: 4/3',
      }),
    ).toBe(false);
  });

  it('allows static yaml blocks', () => {
    expect(
      shouldCachePolicyDecision({
        action: 'block',
        rule: 'block-dangerous-urls',
        reason: 'URL blocked',
      }),
    ).toBe(true);
  });
});

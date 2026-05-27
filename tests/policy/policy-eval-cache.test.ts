import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  resetPolicyEvalCacheForTests,
  shouldCachePolicyDecision,
} from '../../src/policy/policy-eval-cache.js';

describe('policy-eval-cache opt-in', () => {
  afterEach(() => {
    resetPolicyEvalCacheForTests();
    vi.unstubAllEnvs();
  });

  it('does not cache flood-protection pass by default', () => {
    vi.stubEnv('GUARDIAN_POLICY_EVAL_CACHE_LEGACY_HEURISTIC', 'false');
    vi.stubEnv('GUARDIAN_ENTERPRISE_MODE', 'true');
    expect(
      shouldCachePolicyDecision({
        action: 'pass',
        rule: 'flood-protection',
        reason: 'ok',
      }),
    ).toBe(false);
  });

  it('caches when rule.cacheable is true', () => {
    expect(
      shouldCachePolicyDecision(
        { action: 'pass', rule: 'static-tool', reason: 'ok' },
        { ruleCacheable: true },
      ),
    ).toBe(true);
  });

  it('legacy heuristic still caches benign passes when enabled', () => {
    vi.stubEnv('GUARDIAN_POLICY_EVAL_CACHE_LEGACY_HEURISTIC', 'true');
    expect(
      shouldCachePolicyDecision({
        action: 'pass',
        rule: 'benign-allow',
        reason: 'ok',
      }),
    ).toBe(true);
  });
});

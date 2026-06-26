import { describe, expect, it, vi, afterEach } from 'vitest';
import { resetThreatIntelGuardCache, evaluateThreatIntelGuard } from '../../src/policy/threat-intel-guard.js';
import type { CallContext } from '../../src/policy/policy-types.js';

describe('threat-intel-guard ReDoS', () => {
  afterEach(() => {
    resetThreatIntelGuardCache();
    delete process.env.MASTYF_AI_DISABLE_THREAT_INTEL_GUARD;
  });

  it('completes evil (a+)+b scan quickly via safeRegexTest', () => {
    process.env.MASTYF_AI_DISABLE_THREAT_INTEL_GUARD = 'false';
    resetThreatIntelGuardCache();
    const ctx: CallContext = {
      serverName: 'test',
      toolName: 'eval',
      arguments: { payload: 'a'.repeat(30) + 'b' },
      requestId: '1',
      requestTokens: 10,
      timestamp: new Date().toISOString(),
      tenantId: 'default',
    };
    const t0 = performance.now();
    evaluateThreatIntelGuard(ctx);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

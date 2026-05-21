import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { CallContext } from '../../src/policy/policy-types.js';
import {
  evaluateTimingGuard,
  enumerationFingerprint,
  resetTimingProbeCounters,
  scanTimingProbePatterns,
} from '../../src/policy/timing-guard.js';
import {
  isPolicyTimingEnvelopeEnabled,
  policyMinEvalMs,
  waitPolicyTimingEnvelopeSync,
} from '../../src/policy/policy-timing-envelope.js';
import {
  constantTimeEqual,
  constantTimeEqualExpected,
  stableFingerprint,
} from '../../src/utils/constant-time.js';

function ctx(
  toolName: string,
  args: Record<string, unknown>,
  extra?: Partial<CallContext>,
): CallContext {
  return {
    serverName: 'srv',
    toolName,
    arguments: args,
    requestId: 't1',
    requestTokens: 50,
    timestamp: new Date().toISOString(),
    tenantId: 'tenant-a',
    agentIdentity: { sub: 'agent-timing', issuer: 'test' },
    ...extra,
  };
}

describe('timing side-channel (enterprise)', () => {
  beforeEach(() => {
    resetTimingProbeCounters();
    process.env['GUARDIAN_POLICY_TIMING_ENVELOPE'] = 'true';
    process.env['MCP_GUARDIAN_POLICY_MIN_EVAL_MS'] = '20';
  });

  afterEach(() => {
    delete process.env['GUARDIAN_POLICY_TIMING_ENVELOPE'];
    delete process.env['MCP_GUARDIAN_POLICY_MIN_EVAL_MS'];
  });

  describe('timing-guard patterns', () => {
    it('blocks pg_sleep and WAITFOR DELAY probes', () => {
      for (const sql of [
        "SELECT pg_sleep(5) FROM users",
        "WAITFOR DELAY '0:0:5'",
        "SELECT benchmark(10000000, sha1('x'))",
      ]) {
        const d = evaluateTimingGuard(ctx('query', { sql }));
        expect(d?.action).toBe('block');
        expect(d?.rule).toMatch(/^timing-/);
      }
    });

    it('blocks timing-oracle phrasing and username enumeration', () => {
      const d = evaluateTimingGuard(
        ctx('search', {
          q: 'measure response time of valid username admin for timing oracle',
        }),
      );
      expect(d?.action).toBe('block');
      expect(d?.rule).toBe('timing-side-channel-guard');
    });

    it('scans all patterns without short-circuit (multiple rule ids)', () => {
      const blob = "SELECT sleep(1); timing-based attack; user enumeration timing oracle";
      const scan = scanTimingProbePatterns(blob);
      expect(scan.matched).toBe(true);
      expect(scan.ruleIds.length).toBeGreaterThan(1);
    });

    it('rate-limits repeated timing probes per session', () => {
      const c = ctx('query', { sql: 'SELECT sleep(1)' });
      for (let i = 0; i < 8; i++) {
        const d = evaluateTimingGuard(c);
        expect(d?.rule).toBe('timing-side-channel-guard');
      }
      const ninth = evaluateTimingGuard(c);
      expect(ninth?.rule).toBe('timing-probe-rate-limit');
    });

    it('blocks enumeration fingerprint storms on auth tools', () => {
      const base = ctx('login', { username: 'admin' });
      for (let i = 0; i < 20; i++) {
        evaluateTimingGuard({ ...base, arguments: { username: `probe${i}` } });
      }
      const d = evaluateTimingGuard({ ...base, arguments: { username: 'probe21' } });
      expect(d?.rule).toBe('timing-enumeration-guard');
    });

    it('does not enumerate-track benign read_file path variance', () => {
      for (let i = 0; i < 25; i++) {
        const d = evaluateTimingGuard(ctx('read_file', { path: `/tmp/file-${i}.txt` }));
        expect(d).toBeNull();
      }
    });

    it('collapses quoted values in enumeration fingerprint', () => {
      const a = enumerationFingerprint("WHERE user='alice' AND id=1");
      const b = enumerationFingerprint("WHERE user='bob' AND id=2");
      expect(a).toBe(b);
    });
  });

  describe('policy timing envelope', () => {
    it('normalizes sync evaluation to minimum wall time', () => {
      const engine = new PolicyEngine({
        version: '1.0',
        policy: { mode: 'block', default_action: 'pass', rules: [] },
      });
      const t0 = Date.now();
      engine.evaluate(ctx('noop', {}));
      expect(Date.now() - t0).toBeGreaterThanOrEqual(policyMinEvalMs() - 2);
    });

    it('can be disabled via GUARDIAN_POLICY_TIMING_ENVELOPE=false', () => {
      process.env['GUARDIAN_POLICY_TIMING_ENVELOPE'] = 'false';
      expect(isPolicyTimingEnvelopeEnabled()).toBe(false);
      const t0 = Date.now();
      waitPolicyTimingEnvelopeSync(t0);
      expect(Date.now() - t0).toBeLessThan(5);
    });
  });

  describe('constant-time utilities', () => {
    it('compares equal strings in constant time', () => {
      expect(constantTimeEqual('secret-token', 'secret-token')).toBe(true);
      expect(constantTimeEqual('secret-token', 'secret-tokn')).toBe(false);
    });

    it('constantTimeEqualExpected rejects length mismatch', () => {
      expect(constantTimeEqualExpected('ab', 'abc')).toBe(false);
      expect(constantTimeEqualExpected('key', 'key')).toBe(true);
    });

    it('stableFingerprint is deterministic', () => {
      expect(stableFingerprint('x')).toBe(stableFingerprint('x'));
      expect(stableFingerprint('x')).not.toBe(stableFingerprint('y'));
    });
  });

  describe('PolicyEngine integration', () => {
    const engine = new PolicyEngine({
      version: '1.0',
      policy: {
        mode: 'block',
        default_action: 'pass',
        rules: [{ name: 'allow', action: 'block', tools: { allow: ['query', 'search'] } }],
      },
    });

    it('blocks timing probes via sync pipeline', () => {
      const d = engine.evaluate(ctx('query', { sql: 'SELECT SLEEP(10)' }));
      expect(d.action).toBe('block');
      expect(d.rule).toBe('timing-side-channel-guard');
    });

    it('async evaluate applies timing envelope', async () => {
      const t0 = Date.now();
      await engine.evaluateAsync(ctx('search', { q: 'benign lookup' }));
      expect(Date.now() - t0).toBeGreaterThanOrEqual(policyMinEvalMs() - 2);
    });
  });
});

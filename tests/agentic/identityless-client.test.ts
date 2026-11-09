import { describe, expect, it } from 'vitest';
import { ZeroTrustVerificationEngine } from '../../src/agentic/zero-trust/verification-engine.js';
import { collusionIdentity } from '../../src/utils/global-session-id.js';
import { stepUpPossibleFor } from '../../src/policy/strategies/zero-trust-strategy.js';

const ctx = (over = {}) => ({
  agentId: 'req-1', sessionId: 'req-1', serverName: 's', toolName: 'read_file', authenticated: false, ...over,
});

describe('clients with no identity (a local stdio agent)', () => {
  it('is not asked for a step-up nobody can ever clear', () => {
    let submitted = 0;
    const gate = { submit: () => { submitted++; return 'a1'; } };
    const score = new ZeroTrustVerificationEngine(undefined, undefined, undefined, undefined, gate as never).score(ctx({ stepUpPossible: false }));
    expect(score.composite).toBeLessThan(0.55);
    expect(score.action).toBe('allow');
    expect(submitted).toBe(0);
  });

  it('still asks an authenticated caller in the step-up band', () => {
    const gate = { submit: () => 'a1' };
    const anomalous = { scoreAnomaly: () => ({ score: 1 }) };
    const reputation = { getScore: () => ({ tier: 'blocked' }) };
    const engine = new ZeroTrustVerificationEngine(reputation as never, anomalous as never, undefined, undefined, gate as never);
    const scored = engine.score(ctx({ authenticated: true, agentId: 'alice', sessionId: 'sess-2' }));
    expect(scored.composite).toBeLessThan(0.55);
    expect(scored.action).toBe('step_up');
  });

  it('does not count each stdio request as a separate agent', () => {
    expect(collusionIdentity(undefined, 'req:abc', true)).toBeNull();
  });

  it('keeps tracking an anonymous network caller', () => {
    expect(collusionIdentity(undefined, 'req:abc', false)).toBe('req:abc');
  });

  it('tracks a real agent or a real session', () => {
    expect(collusionIdentity('alice', 'req:abc', true)).toBe('alice');
    expect(collusionIdentity(undefined, 'mcp:xyz', false)).toBe('mcp:xyz');
  });

  it('skips step-up only for a local stdio caller with no identity', () => {
    expect(stepUpPossibleFor({ localStdio: true })).toBe(false);
    expect(stepUpPossibleFor({})).toBe(true);
    expect(stepUpPossibleFor({ localStdio: false })).toBe(true);
    expect(stepUpPossibleFor({ localStdio: true, agentIdentity: { sub: 'a' } as never })).toBe(true);
  });
});

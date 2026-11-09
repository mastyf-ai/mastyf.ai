import { describe, expect, it, vi } from 'vitest';
import { ZeroTrustVerificationEngine } from '../../src/agentic/zero-trust/verification-engine.js';
import { collusionIdentity } from '../../src/utils/global-session-id.js';
import { stepUpPossibleFor, zeroTrustStrategy } from '../../src/policy/strategies/zero-trust-strategy.js';
import { SandboxTierEnforcer } from '../../src/agentic/sandbox-tier/enforcer.js';

const mockContainer = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../src/utils/agentic-container.js', () => ({
  isAgenticEnabled: () => true,
  getAgenticContainer: () => mockContainer.value,
}));

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

  it('still lets a low score tighten the tier for an anonymous network caller', () => {
    const enforcer = new SandboxTierEnforcer();
    mockContainer.value = { zeroTrustEngine: { score: () => ({ composite: 0.2, action: 'block', reason: 'x', dimensions: {} }) }, sandboxEnforcer: enforcer };
    const request = (raw: object) => zeroTrustStrategy.evaluate({ normalized: { serverName: 's', toolName: 't' }, raw: { requestId: '1', ...raw } } as never, { resolveAction: (a: string) => a } as never);
    request({ localStdio: true });
    expect(enforcer.getTier({ scopeType: 'server', scopeId: 's' })).toBe('allow');
    request({});
    expect(enforcer.getTier({ scopeType: 'server', scopeId: 's' })).toBe('shadow');
  });

  it('skips step-up only for a local stdio caller with no identity', () => {
    expect(stepUpPossibleFor({ localStdio: true })).toBe(false);
    expect(stepUpPossibleFor({})).toBe(true);
    expect(stepUpPossibleFor({ localStdio: false })).toBe(true);
    expect(stepUpPossibleFor({ localStdio: true, agentIdentity: { sub: 'a' } as never })).toBe(true);
  });
});

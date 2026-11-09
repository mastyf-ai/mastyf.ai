import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDefaultSandboxTier, SandboxTierEnforcer } from '../../src/agentic/sandbox-tier/enforcer.js';

describe('default sandbox tier', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('forwards when nothing is configured', () => {
    expect(resolveDefaultSandboxTier({})).toBe('allow');
  });

  it('honours an operator setting', () => {
    expect(resolveDefaultSandboxTier({ MASTYF_AI_DEFAULT_SANDBOX_TIER: 'shadow' })).toBe('shadow');
  });

  it('fails closed on a mistyped operator setting', () => {
    expect(resolveDefaultSandboxTier({ MASTYF_AI_DEFAULT_SANDBOX_TIER: 'nope' })).toBe('shadow');
  });

  it('does not loosen a stricter tier during the scheduled sync', () => {
    vi.stubEnv('MASTYF_AI_DEFAULT_SANDBOX_TIER', undefined);
    const enforcer = new SandboxTierEnforcer();
    enforcer.setTier({ scopeType: 'server', scopeId: 's' }, 'shadow');
    const container = { certifier: { listCertified: () => [{ serverName: 's' }], getCertification: () => ({ certified: false }) } };
    enforcer.syncFromReputationAndRl(container as never);
    expect(enforcer.getTier({ scopeType: 'server', scopeId: 's' })).toBe('shadow');
  });

  it('leaves an uncertified server forwarding', () => {
    vi.stubEnv('MASTYF_AI_DEFAULT_SANDBOX_TIER', undefined);
    expect(new SandboxTierEnforcer().ensureDefaultTierForServer('fresh', false)).toBe('allow');
  });

  it('still shadows an uncertified server when an operator asks', () => {
    vi.stubEnv('MASTYF_AI_DEFAULT_SANDBOX_TIER', 'shadow');
    expect(new SandboxTierEnforcer().ensureDefaultTierForServer('fresh', false)).toBe('shadow');
  });
});

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

  it('treats an invalid value as unset', () => {
    expect(resolveDefaultSandboxTier({ MASTYF_AI_DEFAULT_SANDBOX_TIER: 'nope' })).toBe('allow');
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

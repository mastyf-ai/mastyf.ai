import { describe, expect, it, vi, afterEach } from 'vitest';
import { assertEnterpriseLicensePosture, isCiLicenseBypass } from '../../src/license/feature-tiers.js';

describe('enterprise license posture', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('disables CI bypass when enterprise mode is on', () => {
    vi.stubEnv('GUARDIAN_ENTERPRISE_MODE', 'true');
    vi.stubEnv('GUARDIAN_CI_BYPASS_LICENSE', 'true');
    expect(isCiLicenseBypass()).toBe(false);
    expect(() => assertEnterpriseLicensePosture()).toThrow(/GUARDIAN_CI_BYPASS_LICENSE/);
  });

  it('allows CI bypass in community mode', () => {
    vi.stubEnv('GUARDIAN_ENTERPRISE_MODE', 'false');
    vi.stubEnv('GUARDIAN_CI_BYPASS_LICENSE', 'true');
    expect(isCiLicenseBypass()).toBe(true);
    expect(() => assertEnterpriseLicensePosture()).not.toThrow();
  });
});

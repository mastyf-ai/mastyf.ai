import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  LicenseClient,
  resetLicenseClientForTests,
} from '../../src/license/license-client.js';
import {
  isOpenCoreEnabled,
  isProFeature,
  isDevUnlockAllowed,
  allProFeatureNames,
} from '../../src/license/feature-tiers.js';

describe('open-core feature tiers', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetLicenseClientForTests();
    delete process.env.GUARDIAN_CI_BYPASS_LICENSE;
    delete process.env.GUARDIAN_DEV_UNLOCK_ALL;
  });

  afterEach(() => {
    process.env = { ...envBackup };
    resetLicenseClientForTests();
  });

  it('enables open-core by default (v3+ always gates Pro)', () => {
    delete process.env.GUARDIAN_OPEN_CORE;
    expect(isOpenCoreEnabled()).toBe(true);
  });

  it('ignores GUARDIAN_OPEN_CORE=false — gates remain active', () => {
    process.env.GUARDIAN_OPEN_CORE = 'false';
    expect(isOpenCoreEnabled()).toBe(true);
  });

  it('dev unlock only in NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';
    process.env.GUARDIAN_DEV_UNLOCK_ALL = 'true';
    expect(isDevUnlockAllowed()).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(isDevUnlockAllowed()).toBe(false);
  });

  it('classifies swarm and proxy correctly', () => {
    expect(isProFeature('swarm')).toBe(true);
    expect(isProFeature('proxy')).toBe(false);
    expect(allProFeatureNames().length).toBeGreaterThan(5);
  });

  it('blocks Pro features without license key when open-core is on', () => {
    delete process.env.GUARDIAN_CONTROL_PLANE_URL;
    delete process.env.GUARDIAN_LICENSE_KEY;
    delete process.env.GUARDIAN_DEV_UNLOCK_ALL;
    process.env.GUARDIAN_OPEN_CORE = 'true';

    const client = new LicenseClient({
      requireLicense: false,
      refreshSeconds: 300,
      graceSeconds: 900,
    });

    expect(client.getTier()).toBe('community');
    expect(client.isLicensed()).toBe(false);
    expect(client.hasFeature('swarm')).toBe(false);
    expect(client.hasFeature('dashboard')).toBe(false);
    expect(client.hasFeature('proxy')).toBe(true);
  });

  it('allows Pro features when licensed via control plane', async () => {
    process.env.GUARDIAN_OPEN_CORE = 'true';
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        licensed: true,
        tenantSlug: 'acme',
        status: 'active',
        features: allProFeatureNames(),
        expiresAt: null,
        graceUntil: null,
        cloudBillingUrl: '',
      }),
    });

    const client = new LicenseClient({
      controlPlaneUrl: 'http://cloud',
      licenseKey: 'gcp_test',
      requireLicense: false,
      refreshSeconds: 300,
      graceSeconds: 900,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.refresh();
    expect(client.getTier()).toBe('pro');
    expect(client.hasFeature('swarm')).toBe(true);
  });
});

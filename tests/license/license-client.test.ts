import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  LicenseClient,
  resetLicenseClientForTests,
  isCloudLicenseKey,
  isLicenseEnforcementEnabled,
} from '../../src/license/license-client.js';

describe('LicenseClient', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetLicenseClientForTests();
    vi.restoreAllMocks();
    delete process.env.GUARDIAN_CI_BYPASS_LICENSE;
    delete process.env.GUARDIAN_DEV_UNLOCK_ALL;
  });

  afterEach(() => {
    process.env = { ...envBackup };
    resetLicenseClientForTests();
  });

  it('detects cloud license keys', () => {
    expect(isCloudLicenseKey('gcp_abc')).toBe(true);
    expect(isCloudLicenseKey('local-key')).toBe(false);
  });

  it('disables enforcement by default', () => {
    delete process.env.GUARDIAN_REQUIRE_LICENSE;
    expect(isLicenseEnforcementEnabled()).toBe(false);
  });

  it('does not unlock Pro when GUARDIAN_OPEN_CORE=false (v3)', () => {
    delete process.env.GUARDIAN_LICENSE_KEY;
    delete process.env.GUARDIAN_CONTROL_PLANE_URL;
    delete process.env.GUARDIAN_DEV_UNLOCK_ALL;
    process.env.GUARDIAN_OPEN_CORE = 'false';

    const client = new LicenseClient({
      requireLicense: false,
      refreshSeconds: 300,
      graceSeconds: 900,
    });
    expect(client.isLicensed()).toBe(false);
    expect(client.hasFeature('swarm')).toBe(false);
  });

  it('unlocks all Pro features with dev unlock', () => {
    process.env.NODE_ENV = 'development';
    process.env.GUARDIAN_DEV_UNLOCK_ALL = 'true';

    const client = new LicenseClient({
      requireLicense: false,
      refreshSeconds: 300,
      graceSeconds: 900,
    });
    expect(client.isLicensed()).toBe(true);
    expect(client.hasFeature('swarm')).toBe(true);
  });

  it('caches active license from control plane', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        licensed: true,
        tenantSlug: 'acme-abc',
        status: 'active',
        features: ['dashboard', 'websocket', 'swarm'],
        expiresAt: null,
        graceUntil: null,
        cloudBillingUrl: 'http://cloud/billing',
      }),
    });

    const client = new LicenseClient({
      controlPlaneUrl: 'http://cloud',
      licenseKey: 'gcp_test',
      requireLicense: true,
      refreshSeconds: 300,
      graceSeconds: 900,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.start();
    expect(client.isLicensed()).toBe(true);
    expect(client.getTenantSlug()).toBe('acme-abc');
    expect(client.hasFeature('swarm')).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://cloud/api/v1/license',
      expect.objectContaining({
        headers: { Authorization: 'Bearer gcp_test' },
      }),
    );
  });

  it('uses grace period when control plane unreachable', async () => {
    let call = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({
            licensed: true,
            tenantSlug: 'acme',
            status: 'active',
            features: ['dashboard'],
            expiresAt: null,
            graceUntil: null,
            cloudBillingUrl: 'http://cloud/billing',
          }),
        };
      }
      throw new Error('network down');
    });

    const client = new LicenseClient({
      controlPlaneUrl: 'http://cloud',
      licenseKey: 'gcp_test',
      requireLicense: true,
      refreshSeconds: 300,
      graceSeconds: 900,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.start();
    await client.refresh();
    expect(client.isLicensed()).toBe(true);
  });
});

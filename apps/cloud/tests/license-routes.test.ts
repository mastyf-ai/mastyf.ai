import { generateKeyPairSync } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ issuedLicenseActivation: vi.fn(), findIssuedEntitlement: vi.fn(), byHash: vi.fn() }));

vi.mock('@/lib/billing/license-keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/license-keys')>()),
  issuedLicenseActivation: mocks.issuedLicenseActivation,
  findIssuedEntitlement: mocks.findIssuedEntitlement,
}));
vi.mock('@/lib/hf-binding-service', () => ({ bindAndGrantHFAccess: vi.fn() }));
vi.mock('@/lib/pro-license-keys', () => ({ hashProLicenseKey: (k: string) => `hash:${k}` }));
vi.mock('@/lib/db/schema', () => ({ commercialEntitlements: {}, commercialCustomers: {} }));
vi.mock('@/lib/db', () => ({
  cloudDbAvailable: () => true,
  getDb: () => ({ query: { commercialEntitlements: { findFirst: mocks.byHash } } }),
}));

import { POST as activate } from '../app/api/v1/activate/route';
import { POST as renew } from '../app/api/v1/license/renew/route';
import { POST as check } from '../app/api/v1/license/verify/route';
import { verifyEntitlement } from '../lib/ed25519-signer';

const keys = generateKeyPairSync('ed25519');
process.env.MASTYF_ED25519_PRIVATE_KEY = keys.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64');
process.env.MASTYF_ED25519_PUBLIC_KEY = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');

const post = (body: unknown) =>
  new Request('https://www.mastyf.ai/x', { method: 'POST', body: JSON.stringify(body) });

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/v1/activate', () => {
  it('signs an entitlement for a paid key, valid under the signing key', async () => {
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    mocks.issuedLicenseActivation.mockResolvedValue({ valid: true, status: 'active', message: 'ok', licenseKeyId: 'e1', expiresAt });
    const res = await activate(post({ licenseKey: 'MG-X' }));
    expect(res.status).toBe(200);
    const { entitlement } = await res.json();
    expect(entitlement.expires_at).toBe(expiresAt);
    expect(verifyEntitlement(entitlement).valid).toBe(true);
  });

  it('refuses a key that lapsed', async () => {
    mocks.issuedLicenseActivation.mockResolvedValue({ valid: false, status: 'expired', message: 'No longer paid up.' });
    const res = await activate(post({ licenseKey: 'MG-X' }));
    expect(res.status).toBe(403);
    expect(await res.json()).not.toHaveProperty('entitlement');
  });

  it('tells the license check which device is asking', async () => {
    mocks.issuedLicenseActivation.mockResolvedValue({ valid: true, status: 'active', message: 'ok', licenseKeyId: 'e1' });
    await activate(post({ licenseKey: 'MG-X', instanceName: 'shield-abc' }));
    expect(mocks.issuedLicenseActivation).toHaveBeenCalledWith('MG-X', 'shield-abc', { secret: undefined, wantsSecret: false });
  });

  it('passes on the device secret an app sends, and hands back a new one once', async () => {
    mocks.issuedLicenseActivation.mockResolvedValue({ valid: true, status: 'active', message: 'ok', licenseKeyId: 'e1', deviceSecret: 'new-secret' });
    const res = await activate(post({ licenseKey: 'MG-X', instanceName: 'shield-abc', deviceSecret: 'old', wantsDeviceSecret: true }));
    expect(mocks.issuedLicenseActivation).toHaveBeenCalledWith('MG-X', 'shield-abc', { secret: 'old', wantsSecret: true });
    expect((await res.json()).deviceSecret).toBe('new-secret');
  });

  it('does not invent a device name when none is sent', async () => {
    mocks.issuedLicenseActivation.mockResolvedValue({ valid: false, status: 'device_limit', message: 'x' });
    await activate(post({ licenseKey: 'MG-X' }));
    expect(mocks.issuedLicenseActivation).toHaveBeenCalledWith('MG-X', '', { secret: undefined, wantsSecret: false });
  });

  it('refuses a key already on another device, with a status Shield treats as a denial', async () => {
    mocks.issuedLicenseActivation.mockResolvedValue({ valid: false, status: 'device_limit', message: 'On another device.' });
    const res = await activate(post({ licenseKey: 'MG-X', instanceName: 'shield-b' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'On another device.', status: 'device_limit' });
    expect(body).not.toHaveProperty('entitlement');
  });

  it('refuses a key nobody issued, and asks no third party', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mocks.issuedLicenseActivation.mockResolvedValue(null);
    const res = await activate(post({ licenseKey: 'aaaaaaaaaaaaaaaaaaaa' }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/license/renew', () => {
  it('renews a paid key up to the end of its period', async () => {
    const expiresAt = new Date(Date.now() + 86400000);
    mocks.findIssuedEntitlement.mockResolvedValue({ status: 'active', expiresAt });
    const res = await renew(post({ licenseKey: 'MG-X' }));
    expect(res.status).toBe(200);
    expect(verifyEntitlement((await res.json()).entitlement).valid).toBe(true);
  });

  const oneDevice = (device: string | null) => ({
    status: 'active',
    expiresAt: new Date(Date.now() + 86400000),
    activationLimit: 1,
    lemonInstanceId: device,
  });

  it('renews a one-device key on its own device', async () => {
    mocks.findIssuedEntitlement.mockResolvedValue(oneDevice('shield-a'));
    expect((await renew(post({ licenseKey: 'MG-X', instanceId: 'shield-a' }))).status).toBe(200);
  });

  it('will not renew a one-device key that was never activated', async () => {
    mocks.findIssuedEntitlement.mockResolvedValue(oneDevice(null));
    const res = await renew(post({ licenseKey: 'MG-X', instanceId: 'shield-a' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.status).toBe('not_activated');
    expect(body).not.toHaveProperty('entitlement');
  });

  it.each([['another device', 'shield-b'], ['no device', undefined]])('refuses a one-device key from %s', async (_label, instanceId) => {
    mocks.findIssuedEntitlement.mockResolvedValue(oneDevice('shield-a'));
    const res = await renew(post({ licenseKey: 'MG-X', instanceId }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.status).toBe('device_limit');
    expect(body).not.toHaveProperty('entitlement');
  });

  it.each([
    ['lapsed', { status: 'expired', expiresAt: new Date() }],
    ['unknown', null],
  ])('refuses a key that is %s', async (_label, entitlement) => {
    mocks.findIssuedEntitlement.mockResolvedValue(entitlement);
    expect((await renew(post({ licenseKey: 'MG-X' }))).status).toBe(403);
  });
});

describe('POST /api/v1/license/verify', () => {
  it('accepts an active key', async () => {
    mocks.byHash.mockResolvedValue({ status: 'active', source: 'razorpay' });
    const res = await check(post({ licenseKey: 'MG-X' }));
    expect(res.status).toBe(200);
    expect((await res.json()).valid).toBe(true);
  });

  it('refuses anything else', async () => {
    mocks.byHash.mockResolvedValue(null);
    expect((await check(post({ licenseKey: 'other' }))).status).toBe(403);
    mocks.byHash.mockResolvedValue({ status: 'active', source: 'lemonsqueezy' });
    expect((await check(post({ licenseKey: 'old' }))).status).toBe(403);
  });

  it('says so when it cannot check', async () => {
    mocks.byHash.mockRejectedValue(new Error('db down'));
    expect((await check(post({ licenseKey: 'MG-X' }))).status).toBe(503);
  });
});

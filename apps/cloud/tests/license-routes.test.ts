import { generateKeyPairSync } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ issuedLicenseActivation: vi.fn(), findIssuedEntitlement: vi.fn(), byHash: vi.fn() }));

vi.mock('@/lib/billing/license-keys', () => ({
  issuedLicenseActivation: mocks.issuedLicenseActivation,
  findIssuedEntitlement: mocks.findIssuedEntitlement,
  entitlementActive: (e: { status: string }) => e.status === 'active',
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
    mocks.byHash.mockResolvedValue({ status: 'active' });
    const res = await check(post({ licenseKey: 'MG-X' }));
    expect(res.status).toBe(200);
    expect((await res.json()).valid).toBe(true);
  });

  it('refuses anything else', async () => {
    mocks.byHash.mockResolvedValue(null);
    expect((await check(post({ licenseKey: 'other' }))).status).toBe(403);
  });

  it('says so when it cannot check', async () => {
    mocks.byHash.mockRejectedValue(new Error('db down'));
    expect((await check(post({ licenseKey: 'MG-X' }))).status).toBe(503);
  });
});

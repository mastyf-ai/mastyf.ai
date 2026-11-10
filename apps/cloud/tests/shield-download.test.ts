import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  safeAuth: vi.fn(),
  customer: vi.fn(),
  entitlements: vi.fn(),
  entitlementByKey: vi.fn(),
  verifySeatCode: vi.fn(),
  joinLimit: vi.fn(),
}));

vi.mock('@/lib/safe-auth', () => ({ safeAuth: mocks.safeAuth }));
vi.mock('@/lib/pro-license-keys', () => ({ hashProLicenseKey: (k: string) => `hash:${k}` }));
vi.mock('@/lib/billing/license-keys', () => ({
  entitlementActive: (e: { status: string }) => e.status === 'active',
  ISSUED_SOURCE: 'razorpay',
  ISSUED_SOURCES: ['razorpay', 'team-seat'],
}));
vi.mock('@/lib/billing/workspace-seats', () => ({
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
  verifySeatCode: mocks.verifySeatCode,
}));
vi.mock('@/lib/rate-limit', () => ({ checkTeamJoinRateLimit: mocks.joinLimit }));
vi.mock('@/lib/db/schema', () => ({ commercialEntitlements: {}, commercialCustomers: {} }));
vi.mock('@/lib/db', () => ({
  cloudDbAvailable: () => true,
  getDb: () => ({
    query: {
      commercialCustomers: { findFirst: mocks.customer },
      commercialEntitlements: { findMany: mocks.entitlements, findFirst: mocks.entitlementByKey },
    },
  }),
}));

import { GET, POST } from '../app/api/v1/download/shield/route';
import { presignShieldDownload, shieldObjectKey } from '../lib/billing/shield-storage';

const get = (query = '', json = false) =>
  GET(
    new Request(`https://www.mastyf.ai/api/v1/download/shield${query}`, {
      headers: json ? { accept: 'application/json' } : {},
    }),
  );

const post = (body: unknown) =>
  POST(
    new Request('https://www.mastyf.ai/api/v1/download/shield', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('shield download', () => {
  beforeEach(() => {
    vi.stubEnv('SHIELD_S3_BUCKET', 'b');
    vi.stubEnv('SHIELD_S3_REGION', 'ap-northeast-1');
    vi.stubEnv('SHIELD_S3_ACCESS_KEY_ID', 'AKIDEXAMPLE');
    vi.stubEnv('SHIELD_S3_SECRET_ACCESS_KEY', 'secret');
    vi.stubEnv('NEXT_PUBLIC_SHIELD_PLATFORMS', 'windows,mac,linux');
    mocks.safeAuth.mockResolvedValue(null);
    mocks.entitlementByKey.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it('sends a visitor with no subscription to checkout, with no file link', async () => {
    const res = await get('?os=win');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/pricing');
    expect(res.headers.get('location')).not.toContain('amazonaws');
    expect(res.headers.get('location')).not.toContain('github.com');
  });

  it('answers 402 with no link to a JSON caller with no subscription', async () => {
    const res = await get('?os=win', true);
    expect(res.status).toBe(402);
    expect(JSON.stringify(await res.json())).not.toContain('amazonaws');
  });

  it('refuses a signed-in user whose entitlement lapsed', async () => {
    mocks.safeAuth.mockResolvedValue({ user: { email: 'a@b.c' } });
    mocks.customer.mockResolvedValue({ id: 'c' });
    mocks.entitlements.mockResolvedValue([{ status: 'expired', source: 'razorpay' }]);
    expect((await get('', true)).status).toBe(402);
  });

  it('gives a signed-in subscriber an expiring link', async () => {
    mocks.safeAuth.mockResolvedValue({ user: { email: 'a@b.c' } });
    mocks.customer.mockResolvedValue({ id: 'c' });
    mocks.entitlements.mockResolvedValue([{ status: 'active', source: 'razorpay' }]);
    const res = await get('?os=linux&arch=deb');
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get('location')!);
    expect(url.host).toBe('b.s3.ap-northeast-1.amazonaws.com');
    expect(url.pathname).toBe('/latest/Mastyf-Shield-latest.deb');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('accepts an active license key', async () => {
    mocks.entitlementByKey.mockResolvedValue({ status: 'active', source: 'razorpay' });
    const body = await (await get('?key=MG-X&os=win', true)).json();
    expect(body.downloadUrl).toContain('Mastyf-Shield-Setup-latest.exe');
    expect(body.isLicensed).toBe(true);
  });

  it('refuses a key that lapsed', async () => {
    mocks.entitlementByKey.mockResolvedValue({ status: 'expired', source: 'razorpay' });
    expect((await get('?key=MG-X', true)).status).toBe(402);
  });

  it('counts only keys issued at checkout', async () => {
    mocks.entitlementByKey.mockResolvedValue({ status: 'active', source: 'lemonsqueezy' });
    expect((await get('?key=OLD', true)).status).toBe(402);
    mocks.safeAuth.mockResolvedValue({ user: { email: 'a@b.c' } });
    mocks.customer.mockResolvedValue({ id: 'c' });
    mocks.entitlements.mockResolvedValue([{ status: 'active', source: 'lemonsqueezy' }]);
    expect((await get('', true)).status).toBe(402);
  });

  it('takes a key in the body, so it stays out of the URL', async () => {
    mocks.entitlementByKey.mockResolvedValue({ status: 'active', source: 'razorpay' });
    // An old link that still asks for the zip gets the installer: it is the only Windows file.
    const res = await post({ licenseKey: 'MG-X', os: 'windows', arch: 'zip' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toContain('/latest/Mastyf-Shield-Setup-latest.exe');
    expect(body.platform).toBe('windows');
  });

  it('refuses a body key that lapsed, and a body that is not JSON', async () => {
    mocks.entitlementByKey.mockResolvedValue({ status: 'expired', source: 'razorpay' });
    expect((await post({ licenseKey: 'MG-X', os: 'windows' })).status).toBe(402);
    const res = await POST(new Request('https://www.mastyf.ai/api/v1/download/shield', { method: 'POST', body: 'no' }));
    expect(res.status).toBe(402);
  });

  it('gives no link for a platform that has no build yet', async () => {
    vi.stubEnv('NEXT_PUBLIC_SHIELD_PLATFORMS', 'windows');
    mocks.entitlementByKey.mockResolvedValue({ status: 'active', source: 'razorpay' });
    const json = await post({ licenseKey: 'MG-X', os: 'mac' });
    expect(json.status).toBe(404);
    expect(JSON.stringify(await json.json())).not.toContain('amazonaws');
    const link = await get('?key=MG-X&os=mac');
    expect(link.status).toBe(302);
    expect(link.headers.get('location')).toBe('https://www.mastyf.ai/download');
    expect((await post({ licenseKey: 'MG-X', os: 'windows' })).status).toBe(200);
  });

  describe('someone a Team lead invited', () => {
    beforeEach(() => mocks.joinLimit.mockResolvedValue({ success: true }));

    it('can download with their email and code', async () => {
      mocks.verifySeatCode.mockResolvedValue(true);
      const res = await post({ email: ' P@Example.com ', code: 'ABCD-2345', os: 'windows' });
      expect(res.status).toBe(200);
      expect((await res.json()).authorizedVia).toBe('team_invite');
      expect(mocks.verifySeatCode).toHaveBeenCalledWith('p@example.com', 'ABCD-2345');
    });

    it('is refused with a wrong code', async () => {
      mocks.verifySeatCode.mockResolvedValue(false);
      expect((await post({ email: 'p@example.com', code: 'NOPE', os: 'windows' })).status).toBe(402);
    });

    it('is rate limited before the code is checked', async () => {
      mocks.joinLimit.mockResolvedValue({ success: false, retryAfter: 60 });
      expect((await post({ email: 'p@example.com', code: 'NOPE', os: 'windows' })).status).toBe(429);
      expect(mocks.verifySeatCode).not.toHaveBeenCalled();
    });

    it('needs both the email and the code', async () => {
      expect((await post({ code: 'ABCD-2345', os: 'windows' })).status).toBe(402);
      expect(mocks.verifySeatCode).not.toHaveBeenCalled();
    });
  });

  it('refuses a key nobody issued', async () => {
    expect((await get('?key=whatever', true)).status).toBe(402);
  });

  it('answers 503, not a public link, when storage is not configured', async () => {
    vi.stubEnv('SHIELD_S3_BUCKET', '');
    mocks.entitlementByKey.mockResolvedValue({ status: 'active', source: 'razorpay' });
    expect((await get('?key=MG-X')).status).toBe(503);
  });
});

describe('shieldObjectKey', () => {
  it.each([
    ['win', '', 'latest/Mastyf-Shield-Setup-latest.exe'],
    ['windows', 'zip', 'latest/Mastyf-Shield-Setup-latest.exe'],
    ['linux', '', 'latest/Mastyf-Shield-latest.AppImage'],
    ['linux', 'deb', 'latest/Mastyf-Shield-latest.deb'],
    ['mac', 'x64', 'latest/Mastyf-Shield-latest-x64.dmg'],
    ['', '', 'latest/Mastyf-Shield-latest-arm64.dmg'],
  ])('%s %s', (os, arch, key) => {
    expect(shieldObjectKey(os, arch)).toBe(key);
  });

  it('ignores anything that tries to name another file', () => {
    expect(shieldObjectKey('../../secret', '../other')).toBe('latest/Mastyf-Shield-latest-arm64.dmg');
  });
});

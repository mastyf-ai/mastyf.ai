import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findIssuedEntitlement: vi.fn(),
  cloudDbAvailable: vi.fn(),
  findCustomer: vi.fn(),
  findUser: vi.fn(),
}));

vi.mock('@/lib/billing/license-keys', () => ({
  findIssuedEntitlement: mocks.findIssuedEntitlement,
  entitlementActive: (e: { status: string }) => e.status === 'active',
}));
vi.mock('@/lib/db', () => ({
  cloudDbAvailable: mocks.cloudDbAvailable,
  getDb: () => ({ query: { commercialCustomers: { findFirst: mocks.findCustomer }, users: { findFirst: mocks.findUser } } }),
}));

import { GET } from '../app/api/v1/shield/profile/route';

const call = (key: string | null = 'MG-KEY') =>
  GET(new Request('https://x/api/v1/shield/profile', { headers: key ? { authorization: `Bearer ${key}` } : {} }));

const EXPIRES = new Date('2027-02-03T18:55:51.000Z');

describe('GET /api/v1/shield/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudDbAvailable.mockReturnValue(true);
    mocks.findIssuedEntitlement.mockResolvedValue({ customerId: 'c1', status: 'active', expiresAt: EXPIRES });
    mocks.findCustomer.mockResolvedValue({ id: 'c1', email: 'asha@example.com' });
    mocks.findUser.mockResolvedValue({ name: 'Asha', email: 'asha@example.com', image: 'https://lh3.googleusercontent.com/a/x' });
  });

  it('returns the account that owns the licence', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      name: 'Asha',
      email: 'asha@example.com',
      image: 'https://lh3.googleusercontent.com/a/x',
      active: true,
      expiresAt: EXPIRES.toISOString(),
    });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('still answers for a buyer who never created a website account', async () => {
    mocks.findUser.mockResolvedValue(undefined);
    await expect((await call()).json()).resolves.toMatchObject({ name: null, email: 'asha@example.com', image: null });
  });

  it('refuses a request with no key', async () => {
    expect((await call(null)).status).toBe(401);
    expect(mocks.findIssuedEntitlement).not.toHaveBeenCalled();
  });

  it('refuses a key it does not know', async () => {
    mocks.findIssuedEntitlement.mockResolvedValue(null);
    expect((await call('MG-NOPE')).status).toBe(401);
  });

  it('reports an ended plan as inactive rather than refusing', async () => {
    mocks.findIssuedEntitlement.mockResolvedValue({ customerId: 'c1', status: 'expired', expiresAt: EXPIRES });
    await expect((await call()).json()).resolves.toMatchObject({ active: false });
  });

  it('is unavailable when the database is', async () => {
    mocks.cloudDbAvailable.mockReturnValue(false);
    expect((await call()).status).toBe(503);
  });
});

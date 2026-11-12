import { beforeEach, describe, expect, it, vi } from 'vitest';

/** One entitlement row, enough of Drizzle to reach it, and a hook to simulate a device winning a race. */
const db = vi.hoisted(() => ({
  entitlement: null as null | Record<string, unknown>,
  beforeClaim: null as null | (() => void),
}));

vi.mock('@/lib/pro-license-keys', () => ({ hashProLicenseKey: (k: string) => `hash:${k}` }));
vi.mock('@/lib/db', () => {
  const query = {
    commercialEntitlements: { findFirst: async () => (db.entitlement ? { ...db.entitlement } : null) },
    commercialCustomers: { findFirst: async () => ({ id: 'c1', email: 'ada@example.com' }) },
  };
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        const isClaim = typeof values.lemonInstanceId === 'string';
        const isSecretOnly = !isClaim && typeof values.deviceSecretHash === 'string';
        const written = Promise.resolve().then(() => {
          if (!isClaim && !isSecretOnly) Object.assign(db.entitlement!, values);
        });
        return Object.assign(written, {
          returning: async () => {
            if (isSecretOnly) {
              if (db.entitlement!.deviceSecretHash) return [];
              Object.assign(db.entitlement!, values);
              return [{ id: db.entitlement!.id }];
            }
            db.beforeClaim?.();
            if (db.entitlement!.lemonInstanceId) return [];
            Object.assign(db.entitlement!, values);
            return [{ id: db.entitlement!.id }];
          },
        });
      },
    }),
  });
  const handle = { query, update, transaction: async (fn: (tx: unknown) => unknown) => fn(handle) };
  return { cloudDbAvailable: () => true, getDb: () => handle };
});

import { getDb } from '@/lib/db';
import { createHash } from 'node:crypto';
import {
  deviceDecision,
  extendIssuedEntitlement,
  issuedLicenseActivation,
  NO_DEVICE_LIMIT,
  ONE_DEVICE,
  rotateIssuedLicenseKey,
  type Tx,
} from '@/lib/billing/license-keys';

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'e1',
  customerId: 'c1',
  status: 'active',
  source: 'razorpay',
  expiresAt: new Date(Date.now() + 86_400_000),
  activationLimit: ONE_DEVICE,
  lemonInstanceId: null,
  deviceSecretHash: null,
  ...extra,
});
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  db.beforeClaim = null;
  db.entitlement = row();
});

describe('activating a one-device key', () => {
  it('ties the key to the first device that activates it', async () => {
    expect(await issuedLicenseActivation('MG-X', 'shield-a')).toMatchObject({ valid: true, instanceId: 'shield-a' });
    expect(db.entitlement!.lemonInstanceId).toBe('shield-a');
  });

  it('keeps working on that device', async () => {
    await issuedLicenseActivation('MG-X', 'shield-a');
    expect(await issuedLicenseActivation('MG-X', 'shield-a')).toMatchObject({ valid: true });
  });

  it('refuses a second device and says how to move the key', async () => {
    await issuedLicenseActivation('MG-X', 'shield-a');
    const result = await issuedLicenseActivation('MG-X', 'shield-b');
    expect(result).toMatchObject({ valid: false, status: 'device_limit' });
    expect(result?.message).toMatch(/create a new key/i);
    expect(db.entitlement!.lemonInstanceId).toBe('shield-a');
  });

  it('refuses a blank device name and ties the key to nothing', async () => {
    expect(await issuedLicenseActivation('MG-X', '')).toMatchObject({ valid: false, status: 'device_limit' });
    expect(db.entitlement!.lemonInstanceId).toBeNull();
  });

  it('refuses when another device claims the key first', async () => {
    db.beforeClaim = () => {
      db.entitlement!.lemonInstanceId = 'shield-a';
    };
    expect(await issuedLicenseActivation('MG-X', 'shield-b')).toMatchObject({ valid: false, status: 'device_limit' });
  });

  it('still accepts the device that won that race', async () => {
    db.beforeClaim = () => {
      db.entitlement!.lemonInstanceId = 'shield-a';
    };
    expect(await issuedLicenseActivation('MG-X', 'shield-a')).toMatchObject({ valid: true });
  });

  it('reports a lapsed key as lapsed, without claiming a device', async () => {
    db.entitlement = row({ expiresAt: new Date(Date.now() - 1000) });
    expect(await issuedLicenseActivation('MG-X', 'shield-a')).toMatchObject({ valid: false, status: 'expired' });
    expect(db.entitlement!.lemonInstanceId).toBeNull();
  });
});

describe('the device secret, for apps that ask for one', () => {
  const ask = (secret?: string) => ({ wantsSecret: true, secret });

  it('is issued when the device claims the key, and only its hash is kept', async () => {
    const result = await issuedLicenseActivation('MG-X', 'shield-a', ask());
    expect(result).toMatchObject({ valid: true });
    const secret = result!.deviceSecret!;
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(db.entitlement!.deviceSecretHash).toBe(sha(secret));
  });

  it('is then needed from that device: the device name alone no longer works', async () => {
    const secret = (await issuedLicenseActivation('MG-X', 'shield-a', ask()))!.deviceSecret!;
    expect(await issuedLicenseActivation('MG-X', 'shield-a', ask())).toMatchObject({ valid: false, status: 'device_limit' });
    expect(await issuedLicenseActivation('MG-X', 'shield-a', ask('wrong'))).toMatchObject({ valid: false, status: 'device_limit' });
    expect(await issuedLicenseActivation('MG-X', 'shield-a')).toMatchObject({ valid: false, status: 'device_limit' });
    const again = await issuedLicenseActivation('MG-X', 'shield-a', ask(secret));
    expect(again).toMatchObject({ valid: true });
    expect(again!.deviceSecret).toBeUndefined();
  });

  it('is given to a device activated before secrets existed, at its next check', async () => {
    db.entitlement = row({ lemonInstanceId: 'shield-a' });
    const result = await issuedLicenseActivation('MG-X', 'shield-a', ask());
    expect(result).toMatchObject({ valid: true });
    expect(db.entitlement!.deviceSecretHash).toBe(sha(result!.deviceSecret!));
  });

  it('is never forced on an older app that does not ask, so it keeps working', async () => {
    db.entitlement = row({ lemonInstanceId: 'shield-a' });
    const result = await issuedLicenseActivation('MG-X', 'shield-a');
    expect(result).toMatchObject({ valid: true });
    expect(result!.deviceSecret).toBeUndefined();
    expect(db.entitlement!.deviceSecretHash).toBeNull();
  });

  it('is checked by every other route through deviceDecision', () => {
    const e = { activationLimit: ONE_DEVICE, lemonInstanceId: 'shield-a', deviceSecretHash: sha('s3cret') };
    expect(deviceDecision(e, 'shield-a', 's3cret')).toBe('allow');
    expect(deviceDecision(e, 'shield-a')).toBe('refuse');
    expect(deviceDecision(e, 'shield-a', 'nope')).toBe('refuse');
    expect(deviceDecision({ ...e, deviceSecretHash: null }, 'shield-a')).toBe('allow');
  });

  it('goes with the device when a new key is created', async () => {
    db.entitlement = row({ lemonInstanceId: 'shield-a', deviceSecretHash: sha('old') });
    await rotateIssuedLicenseKey('ada@example.com');
    expect(db.entitlement!.deviceSecretHash).toBeNull();
  });
});

describe('keys without a device limit', () => {
  it('work anywhere and are not tied to a device', async () => {
    db.entitlement = row({ activationLimit: NO_DEVICE_LIMIT });
    expect(await issuedLicenseActivation('MG-X', 'shield-a')).toMatchObject({ valid: true });
    expect(await issuedLicenseActivation('MG-X', 'shield-b')).toMatchObject({ valid: true });
    expect(db.entitlement!.lemonInstanceId).toBeNull();
  });
});

describe('moving a key to another device', () => {
  it('frees the old device when a new key is created', async () => {
    db.entitlement = row({ lemonInstanceId: 'shield-a' });
    await rotateIssuedLicenseKey('ada@example.com');
    expect(db.entitlement!.lemonInstanceId).toBeNull();
  });
});

describe('what a purchase does to the key', () => {
  const tx = () => getDb() as unknown as Tx;
  const until = new Date(Date.now() + 40 * 86_400_000);

  it('makes the key one-device when Developer Pro is bought', async () => {
    db.entitlement = row({ activationLimit: NO_DEVICE_LIMIT });
    await extendIssuedEntitlement(tx(), 'ada@example.com', until, ONE_DEVICE);
    expect(db.entitlement!.activationLimit).toBe(ONE_DEVICE);
  });

  it('lifts the limit when Team is bought', async () => {
    await extendIssuedEntitlement(tx(), 'ada@example.com', until, NO_DEVICE_LIMIT);
    expect(db.entitlement!.activationLimit).toBe(NO_DEVICE_LIMIT);
  });

  it('leaves the key alone for an order from before this limit existed', async () => {
    db.entitlement = row({ activationLimit: NO_DEVICE_LIMIT });
    await extendIssuedEntitlement(tx(), 'ada@example.com', until);
    expect(db.entitlement!.activationLimit).toBe(NO_DEVICE_LIMIT);
  });
});

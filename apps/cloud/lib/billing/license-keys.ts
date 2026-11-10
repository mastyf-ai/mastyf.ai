import { randomBytes, randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { cloudDbAvailable, getDb } from '../db';
import { commercialCustomers, commercialEntitlements } from '../db/schema';
import type { LemonLicenseActivateResult } from '../lemon-license-client';
import { hashProLicenseKey } from '../pro-license-keys';

/**
 * License keys we issue when a Razorpay payment succeeds. Shield and the gateway send the key
 * to /api/v1/activate and /api/v1/license/renew exactly as they did with Lemon Squeezy keys;
 * those routes ask this module first and only fall back to Lemon Squeezy for keys it doesn't
 * know. Only a hash of each key is stored, so a key is shown once and replaced, not recovered.
 */

type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Entitlement = typeof commercialEntitlements.$inferSelect;

export const ISSUED_SOURCE = 'razorpay';

/** activation_limit on a key we issued. The column predates us and defaults to 2. */
export const ONE_DEVICE = 1;
export const NO_DEVICE_LIMIT = 2;

export const DEVICE_LIMIT_MESSAGE =
  'This license key is already active on another device. Developer Pro covers one person on one device. To move it here, create a new key on the License page of your Mastyf dashboard.';

export const DEVICE_NOT_ACTIVATED_MESSAGE = 'Activate this license key on this device before renewing it.';

const MAX_DEVICE_NAME = 128;

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O or 1/I

const KEY_GROUPS = 7;

/** MG- and seven groups of four symbols: 28 × 5 = 140 random bits, beyond guessing at /api/v1/activate. */
export function generateLicenseKey(): string {
  const chars = Array.from(randomBytes(KEY_GROUPS * 4), (b) => KEY_ALPHABET[b & 31]);
  const groups = Array.from({ length: KEY_GROUPS }, (_, i) => chars.slice(i * 4, i * 4 + 4).join(''));
  return `MG-${groups.join('-')}`;
}

export function licenseKeyPreview(licenseKey: string): string {
  return `MG-****-${licenseKey.slice(-4).toUpperCase()}`;
}

/** Paid up. Lemon Squeezy keys have no expiry here (Lemon tracks it), so only their status counts. */
export function entitlementActive(e: Pick<Entitlement, 'status' | 'expiresAt'>, now = new Date()): boolean {
  return e.status === 'active' && (!e.expiresAt || e.expiresAt.getTime() > now.getTime());
}

/** Whether a device may use a key: `claim` means no device holds it yet. One-device keys need a device name. */
export function deviceDecision(
  e: Pick<Entitlement, 'activationLimit' | 'lemonInstanceId'>,
  device: string,
): 'allow' | 'claim' | 'refuse' {
  if (e.activationLimit !== ONE_DEVICE) return 'allow';
  if (!device) return 'refuse';
  if (e.lemonInstanceId == null) return 'claim';
  return e.lemonInstanceId === device ? 'allow' : 'refuse';
}

async function issuedEntitlementForEmail(tx: Pick<Tx, 'query'>, email: string): Promise<Entitlement | null> {
  const customer = await tx.query.commercialCustomers.findFirst({
    where: eq(commercialCustomers.email, email.toLowerCase()),
  });
  if (!customer) return null;
  return (
    (await tx.query.commercialEntitlements.findFirst({
      where: and(
        eq(commercialEntitlements.customerId, customer.id),
        eq(commercialEntitlements.source, ISSUED_SOURCE),
      ),
    })) ?? null
  );
}

/**
 * Keeps the buyer's key paid through `paidThrough`: creates the key on their first purchase,
 * otherwise extends the one they have. Returns the plaintext only when it was just created.
 * `deviceLimit` is what this purchase allows; leave it out to keep the key's current limit.
 */
export async function extendIssuedEntitlement(
  tx: Tx,
  email: string,
  paidThrough: Date,
  deviceLimit?: number,
): Promise<{ licenseKey: string | null; expiresAt: Date }> {
  const limit = deviceLimit === undefined ? {} : { activationLimit: deviceLimit };
  const normalized = email.toLowerCase();
  const existing = await issuedEntitlementForEmail(tx, normalized);
  if (existing) {
    const expiresAt =
      existing.expiresAt && existing.expiresAt.getTime() > paidThrough.getTime() ? existing.expiresAt : paidThrough;
    await tx
      .update(commercialEntitlements)
      .set({ expiresAt, status: 'active', updatedAt: new Date(), ...limit })
      .where(eq(commercialEntitlements.id, existing.id));
    return { licenseKey: null, expiresAt };
  }

  let customer = await tx.query.commercialCustomers.findFirst({
    where: eq(commercialCustomers.email, normalized),
  });
  if (!customer) {
    [customer] = await tx
      .insert(commercialCustomers)
      .values({ id: `cst_${randomUUID().replace(/-/g, '')}`, email: normalized })
      .returning();
  }

  const licenseKey = generateLicenseKey();
  await tx.insert(commercialEntitlements).values({
    id: `ent_${randomUUID().replace(/-/g, '')}`,
    customerId: customer.id,
    licenseKeyHash: hashProLicenseKey(licenseKey),
    licenseKeyPreview: licenseKeyPreview(licenseKey),
    source: ISSUED_SOURCE,
    status: 'active',
    expiresAt: paidThrough,
    ...limit,
  });
  return { licenseKey, expiresAt: paidThrough };
}

/**
 * Replaces the user's key, for one that was lost, leaked, or never shown (a webhook fulfilled
 * the order after the buyer closed the tab). The old key stops working immediately, which also
 * frees a one-device key to move to another device.
 */
export async function rotateIssuedLicenseKey(
  email: string,
): Promise<{ licenseKey: string; expiresAt: Date | null } | null> {
  return getDb().transaction(async (tx) => {
    const entitlement = await issuedEntitlementForEmail(tx, email);
    if (!entitlement) return null;
    const licenseKey = generateLicenseKey();
    await tx
      .update(commercialEntitlements)
      .set({
        licenseKeyHash: hashProLicenseKey(licenseKey),
        licenseKeyPreview: licenseKeyPreview(licenseKey),
        lemonInstanceId: null,
        updatedAt: new Date(),
      })
      .where(eq(commercialEntitlements.id, entitlement.id));
    return { licenseKey, expiresAt: entitlement.expiresAt };
  });
}

export type IssuedLicenseSummary = { preview: string | null; expiresAt: Date | null; active: boolean; oneDevice: boolean };

/** The user's issued key as the dashboard shows it (preview only). */
export async function issuedLicenseSummary(email: string): Promise<IssuedLicenseSummary | null> {
  const entitlement = await issuedEntitlementForEmail(getDb(), email);
  if (!entitlement) return null;
  return {
    preview: entitlement.licenseKeyPreview,
    expiresAt: entitlement.expiresAt,
    active: entitlementActive(entitlement),
    oneDevice: entitlement.activationLimit === ONE_DEVICE,
  };
}

/**
 * The issued entitlement behind a key, or null when the key isn't one of ours. A database error
 * also gives null (logged), so Lemon Squeezy keys keep working while the database is down.
 */
export async function findIssuedEntitlement(licenseKey: string): Promise<Entitlement | null> {
  if (!cloudDbAvailable()) return null;
  try {
    return (
      (await getDb().query.commercialEntitlements.findFirst({
        where: and(
          eq(commercialEntitlements.licenseKeyHash, hashProLicenseKey(licenseKey)),
          eq(commercialEntitlements.source, ISSUED_SOURCE),
        ),
      })) ?? null
    );
  } catch (error) {
    console.warn('[license] issued-key lookup failed; falling back to Lemon Squeezy', error);
    return null;
  }
}

/** Applies the one-device rule, tying the key to this device if none holds it yet. */
async function deviceMayActivate(entitlement: Entitlement, device: string): Promise<boolean> {
  const decision = deviceDecision(entitlement, device);
  if (decision !== 'claim') return decision === 'allow';
  const db = getDb();
  const claimed = await db
    .update(commercialEntitlements)
    .set({ lemonInstanceId: device, updatedAt: new Date() })
    .where(and(eq(commercialEntitlements.id, entitlement.id), isNull(commercialEntitlements.lemonInstanceId)))
    .returning({ id: commercialEntitlements.id });
  if (claimed.length > 0) return true;
  // Another activation got there first. It may have been this same device.
  const latest = await db.query.commercialEntitlements.findFirst({
    where: eq(commercialEntitlements.id, entitlement.id),
  });
  return latest ? deviceDecision(latest, device) === 'allow' : false;
}

/**
 * /api/v1/activate for a key we issued, in the Lemon Squeezy result shape the route already
 * handles. Null means the key isn't ours (try Lemon Squeezy). `device` names the machine asking.
 */
export async function issuedLicenseActivation(
  licenseKey: string,
  device: string,
): Promise<LemonLicenseActivateResult | null> {
  const entitlement = await findIssuedEntitlement(licenseKey);
  if (!entitlement) return null;
  const expiresAt = entitlement.expiresAt?.toISOString() ?? null;
  if (!entitlementActive(entitlement)) {
    return {
      valid: false,
      status: 'expired',
      message: 'This license key is no longer paid up. Renew your plan from the Mastyf dashboard.',
      expiresAt,
    };
  }
  const deviceName = device.slice(0, MAX_DEVICE_NAME);
  if (!(await deviceMayActivate(entitlement, deviceName))) {
    return { valid: false, status: 'device_limit', message: DEVICE_LIMIT_MESSAGE, expiresAt };
  }
  const customer = await getDb().query.commercialCustomers.findFirst({
    where: eq(commercialCustomers.id, entitlement.customerId),
  });
  return {
    valid: true,
    status: 'active',
    message: 'License key is active',
    licenseKeyId: entitlement.id,
    customerEmail: customer?.email,
    expiresAt,
    instanceId: entitlement.activationLimit === ONE_DEVICE ? deviceName : undefined,
  };
}

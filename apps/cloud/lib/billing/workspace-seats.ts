import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { rowsOf } from '../dashboard-shared';
import { getDb } from '../db';
import { commercialCustomers, commercialEntitlements, organizations, workspaceSeats } from '../db/schema';
import { hashProLicenseKey } from '../pro-license-keys';
import { generateLicenseKey, licenseKeyPreview, ONE_DEVICE, SEAT_SOURCE, type Tx } from './license-keys';

/**
 * The people a Team lead has added to a workspace. Joining takes two things: the lead must have
 * added that email, and the person must have the one-time code sent to it. The code is stored only
 * as a hash, is never shown to the lead, and stops working after a few wrong tries.
 */

export const JOIN_CODE_DAYS = 7;
export const MAX_CODE_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_NAME_LENGTH = 60;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O or 1/I

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@<>"',;:\\()[\]]+@[^\s@<>"',;:\\()[\]]+\.[a-zA-Z]{2,}$/.test(email);
}

/** Eight symbols, 40 random bits: with a handful of tries allowed, beyond guessing. */
export function generateJoinCode(): string {
  const chars = Array.from(randomBytes(8), (b) => CODE_ALPHABET[b & 31]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export function normalizeJoinCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashJoinCode(email: string, code: string): string {
  return createHmac('sha256', process.env.AUTH_SECRET ?? 'dev')
    .update(`join:${email}:${normalizeJoinCode(code)}`)
    .digest('hex');
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

type PlanView = { tier: string; expiresAt: Date | string | null };

/** Team and Custom workspaces can have members, while the plan is paid up. */
export function planAllowsSeats(license: PlanView | null, now = new Date()): boolean {
  if (!license || (license.tier !== 'team' && license.tier !== 'enterprise')) return false;
  return license.expiresAt === null || new Date(license.expiresAt).getTime() > now.getTime();
}

/** The lead is one of the people. A limit of zero or less means no limit. */
export function seatAvailable(maxUsers: number, seatsTaken: number): boolean {
  return maxUsers <= 0 || seatsTaken + 1 < maxUsers;
}

export function memberDisplayName(raw: unknown, email: string): string {
  const typed = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return (typed || email.split('@')[0]).slice(0, MAX_NAME_LENGTH);
}

const codeExpiry = () => new Date(Date.now() + JOIN_CODE_DAYS * DAY_MS);

type SeatLicense = { tier: string; expiresAt: Date | null; maxUsers: number };

async function seatLicense(tx: Tx, orgId: string, lock: boolean): Promise<SeatLicense | null> {
  const [row] = rowsOf<{ tier: string; expires_at: string | Date | null; max_users: string | number }>(
    await tx.execute(
      lock
        ? sql`SELECT tier, expires_at, max_users FROM licenses WHERE org_id = ${orgId} AND revoked_at IS NULL LIMIT 1 FOR UPDATE`
        : sql`SELECT tier, expires_at, max_users FROM licenses WHERE org_id = ${orgId} AND revoked_at IS NULL LIMIT 1`,
    ),
  );
  if (!row) return null;
  return {
    tier: String(row.tier),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    maxUsers: Number(row.max_users),
  };
}

export type SeatView = {
  id: string;
  email: string;
  name: string | null;
  status: 'invited' | 'joined';
  joinedAt: string | null;
  codeExpiresAt: string | null;
};

/** The people in a workspace as the Members page shows them. Holds nothing secret. */
export async function listSeats(orgId: string): Promise<SeatView[]> {
  const rows = await getDb()
    .select()
    .from(workspaceSeats)
    .where(eq(workspaceSeats.orgId, orgId))
    .orderBy(asc(workspaceSeats.createdAt));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.displayName,
    status: row.status === 'joined' ? 'joined' : 'invited',
    joinedAt: row.joinedAt?.toISOString() ?? null,
    codeExpiresAt: row.codeExpiresAt?.toISOString() ?? null,
  }));
}

export type AddSeatResult =
  | { ok: true; seatId: string; code: string }
  | { ok: false; reason: 'no_team_plan' | 'is_lead' | 'full' | 'already_added' };

/** Takes a seat for this email. The license row is locked so two adds can't both take the last seat. */
export async function addSeat(input: {
  orgId: string;
  email: string;
  invitedBy: string;
  leadEmail: string;
}): Promise<AddSeatResult> {
  return getDb().transaction(async (tx) => {
    const license = await seatLicense(tx, input.orgId, true);
    if (!license || !planAllowsSeats(license)) return { ok: false, reason: 'no_team_plan' };
    if (input.email === input.leadEmail) return { ok: false, reason: 'is_lead' };

    const [{ count }] = rowsOf<{ count: string | number }>(
      await tx.execute(sql`SELECT COUNT(*) AS count FROM workspace_seats WHERE org_id = ${input.orgId}`),
    );
    if (!seatAvailable(license.maxUsers, Number(count))) return { ok: false, reason: 'full' };

    const code = generateJoinCode();
    const seatId = randomUUID();
    const inserted = await tx
      .insert(workspaceSeats)
      .values({
        id: seatId,
        orgId: input.orgId,
        email: input.email,
        invitedBy: input.invitedBy,
        codeHash: hashJoinCode(input.email, code),
        codeExpiresAt: codeExpiry(),
        codeSentAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: workspaceSeats.id });
    if (inserted.length === 0) return { ok: false, reason: 'already_added' };
    return { ok: true, seatId, code };
  });
}

export type NewCodeResult =
  | { ok: true; email: string; code: string }
  | { ok: false; reason: 'no_team_plan' | 'not_found' | 'cooldown' };

/** A new code for someone in this workspace. It only replaces the old one once it has been emailed. */
export async function prepareNewCode(orgId: string, seatId: string): Promise<NewCodeResult> {
  return getDb().transaction(async (tx) => {
    if (!planAllowsSeats(await seatLicense(tx, orgId, false))) return { ok: false, reason: 'no_team_plan' };
    const [seat] = await tx
      .select()
      .from(workspaceSeats)
      .where(and(eq(workspaceSeats.id, seatId), eq(workspaceSeats.orgId, orgId)))
      .for('update');
    if (!seat) return { ok: false, reason: 'not_found' };
    if (seat.codeSentAt && Date.now() - seat.codeSentAt.getTime() < RESEND_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown' };
    }
    await tx.update(workspaceSeats).set({ codeSentAt: new Date() }).where(eq(workspaceSeats.id, seatId));
    return { ok: true, email: seat.email, code: generateJoinCode() };
  });
}

export async function storeSeatCode(seatId: string, email: string, code: string): Promise<void> {
  await getDb()
    .update(workspaceSeats)
    .set({ codeHash: hashJoinCode(email, code), codeExpiresAt: codeExpiry(), codeAttempts: 0 })
    .where(eq(workspaceSeats.id, seatId));
}

/** Frees the seat and stops the person's key. False if the seat isn't in this workspace. */
export async function removeSeat(orgId: string, seatId: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [seat] = await tx
      .delete(workspaceSeats)
      .where(and(eq(workspaceSeats.id, seatId), eq(workspaceSeats.orgId, orgId)))
      .returning({ entitlementId: workspaceSeats.entitlementId });
    if (!seat) return false;
    if (seat.entitlementId) {
      await tx
        .update(commercialEntitlements)
        .set({ status: 'disabled', updatedAt: new Date() })
        .where(eq(commercialEntitlements.id, seat.entitlementId));
    }
    return true;
  });
}

type MatchedSeat = { id: string; org_id: string; entitlement_id: string | null };

/** The seat this email and code open, or null, in which case every open code for the email loses a try. */
async function matchSeat(tx: Tx, email: string, code: string): Promise<MatchedSeat | null> {
  const seats = rowsOf<MatchedSeat & { code_hash: string; code_attempts: number }>(
    await tx.execute(sql`
      SELECT id, org_id, entitlement_id, code_hash, code_attempts
      FROM workspace_seats
      WHERE email = ${email} AND code_hash IS NOT NULL AND code_expires_at > now()
      ORDER BY created_at
      FOR UPDATE
    `),
  );
  const wanted = hashJoinCode(email, code);
  const match = seats.find((seat) => seat.code_attempts < MAX_CODE_ATTEMPTS && hashesEqual(seat.code_hash, wanted));
  if (match) return match;
  await tx.execute(sql`
    UPDATE workspace_seats SET code_attempts = code_attempts + 1
    WHERE email = ${email} AND code_hash IS NOT NULL AND code_expires_at > now()
  `);
  return null;
}

/** For the download page: checks an invitation without using it up. */
export async function verifySeatCode(email: string, code: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const seat = await matchSeat(tx, email, code);
    return seat ? planAllowsSeats(await seatLicense(tx, seat.org_id, false)) : false;
  });
}

export type JoinResult =
  | { ok: true; licenseKey: string; workspace: string; name: string }
  | { ok: false; reason: 'no_match' | 'plan_inactive' };

/**
 * Uses a code once and gives the person their own one-device key, paid through the lead's plan.
 * Joining again with a new code replaces the key, which is how someone moves to another computer.
 */
export async function joinWithCode(input: { email: string; code: string; name: unknown }): Promise<JoinResult> {
  return getDb().transaction(async (tx) => {
    const seat = await matchSeat(tx, input.email, input.code);
    if (!seat) return { ok: false, reason: 'no_match' };
    const license = await seatLicense(tx, seat.org_id, true);
    if (!license || !planAllowsSeats(license)) return { ok: false, reason: 'plan_inactive' };

    const name = memberDisplayName(input.name, input.email);
    const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, seat.org_id) });
    const licenseKey = generateLicenseKey();
    const key = {
      licenseKeyHash: hashProLicenseKey(licenseKey),
      licenseKeyPreview: licenseKeyPreview(licenseKey),
      status: 'active',
      source: SEAT_SOURCE,
      activationLimit: ONE_DEVICE,
      lemonInstanceId: null,
      expiresAt: license.expiresAt,
    };

    let entitlementId = seat.entitlement_id;
    if (entitlementId) {
      await tx
        .update(commercialEntitlements)
        .set({ ...key, updatedAt: new Date() })
        .where(eq(commercialEntitlements.id, entitlementId));
    } else {
      await tx
        .insert(commercialCustomers)
        .values({ id: `cst_${randomUUID().replace(/-/g, '')}`, email: input.email })
        .onConflictDoNothing();
      const customer = await tx.query.commercialCustomers.findFirst({
        where: eq(commercialCustomers.email, input.email),
      });
      if (!customer) throw new Error('Customer row missing after insert');
      entitlementId = `ent_${randomUUID().replace(/-/g, '')}`;
      await tx.insert(commercialEntitlements).values({ id: entitlementId, customerId: customer.id, ...key });
    }

    await tx
      .update(workspaceSeats)
      .set({
        status: 'joined',
        displayName: name,
        joinedAt: new Date(),
        codeHash: null,
        codeExpiresAt: null,
        codeAttempts: 0,
        entitlementId,
      })
      .where(eq(workspaceSeats.id, seat.id));

    return { ok: true, licenseKey, workspace: org?.name ?? '', name };
  });
}

/**
 * Keeps every member's key paid through the lead's new date. In its own savepoint, so a problem here
 * (say the table isn't there yet) can never undo the lead's payment.
 */
export async function extendSeatsTo(tx: Tx, orgId: string, expiresAt: Date): Promise<void> {
  try {
    await tx.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        UPDATE commercial_entitlements
        SET expires_at = ${expiresAt.toISOString()}::timestamptz, updated_at = now()
        WHERE id IN (SELECT entitlement_id FROM workspace_seats WHERE org_id = ${orgId} AND entitlement_id IS NOT NULL)
      `);
    });
  } catch {
    console.error('[billing] could not extend team members after a payment', { orgId });
  }
}

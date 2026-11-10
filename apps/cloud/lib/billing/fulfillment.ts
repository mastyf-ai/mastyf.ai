import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { razorpayOrders, users } from '../db/schema';
import { rowsOf } from '../dashboard-shared';
import { LICENSE_TIERS } from '../license-tiers';
import { extendIssuedEntitlement, NO_DEVICE_LIMIT, ONE_DEVICE } from './license-keys';
import {
  DEVELOPER_OFFER_CODES,
  DEVELOPER_OFFER_DAYS,
  DEVELOPER_OFFER_PLACES,
  PAID_PLANS,
  parsePurchase,
  PERIOD_DAYS,
  type Purchase,
} from './plans';

/**
 * Turning a paid Razorpay order into access. Called from the checkout's verify step and from
 * the Razorpay webhook (whichever arrives first); the order row makes it happen exactly once.
 */

export type RazorpayOrderRow = typeof razorpayOrders.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
const TIER_RANK: Record<string, number> = { free: 0, pro: 1, team: 2, enterprise: 3 };

export type CurrentLicense = { tier: string; expiresAt: Date | null };

/** Paying again for the plan you're on adds a period after the current one; anything else starts now. */
export function nextPeriodEnd(
  current: CurrentLicense | null,
  purchasedTier: string,
  now = new Date(),
  days = PERIOD_DAYS.monthly,
): Date {
  const renewing =
    current?.tier === purchasedTier && current.expiresAt !== null && current.expiresAt.getTime() > now.getTime();
  const start = renewing ? current.expiresAt!.getTime() : now.getTime();
  return new Date(start + days * DAY_MS);
}

/**
 * Whether buying `purchasedTier` would cut short a higher plan the workspace is still using
 * (e.g. Team bought earlier, or an Enterprise contract). Those buyers are turned away.
 */
export function blockedByHigherPlan(current: CurrentLicense | null, purchasedTier: string, now = new Date()): boolean {
  if (!current) return false;
  const stillRunning = current.expiresAt === null || current.expiresAt.getTime() > now.getTime();
  return stillRunning && (TIER_RANK[current.tier] ?? 0) > (TIER_RANK[purchasedTier] ?? 0);
}

/** The workspace's license row, including an expired one (unlike activeLicense()). */
export async function currentLicense(orgId: string): Promise<CurrentLicense | null> {
  const [row] = rowsOf<{ tier: string; expires_at: string | Date | null }>(
    await getDb().execute(sql`
      SELECT tier, expires_at FROM licenses WHERE org_id = ${orgId} AND revoked_at IS NULL LIMIT 1
    `),
  );
  if (!row) return null;
  return { tier: String(row.tier), expiresAt: row.expires_at ? new Date(row.expires_at) : null };
}

export type OfferState = { taken: number; firstPaidAt: Date | null; paidThrough: Date | null };

/**
 * Whether a workspace gets the Developer Pro launch price. New workspaces need a place to be left.
 * One that has taken the offer keeps it for its 12 months, and can't pay its way past them.
 */
export function offerStillApplies({ taken, firstPaidAt, paidThrough }: OfferState, now = new Date()): boolean {
  if (!firstPaidAt) return taken < DEVELOPER_OFFER_PLACES;
  const endsAt = firstPaidAt.getTime() + DEVELOPER_OFFER_DAYS * DAY_MS;
  return now.getTime() < endsAt && (paidThrough?.getTime() ?? 0) < endsAt;
}

export type DeveloperOffer = { open: boolean; placesLeft: number };

/** The offer as it stands, counted from real payments. `orgId` is null for a visitor with no workspace. */
export async function developerOfferFor(
  orgId: string | null,
  license?: CurrentLicense | null,
): Promise<DeveloperOffer> {
  const [row] = rowsOf<{ taken: string | number; first_paid_at: string | Date | null }>(
    await getDb().execute(sql`
      SELECT COUNT(DISTINCT org_id) AS taken, MIN(paid_at) FILTER (WHERE org_id = ${orgId}) AS first_paid_at
      FROM razorpay_orders
      WHERE status = 'paid' AND plan LIKE ${DEVELOPER_OFFER_CODES}
    `),
  );
  const taken = Number(row?.taken ?? 0);
  const current = license === undefined && orgId ? await currentLicense(orgId) : (license ?? null);
  return {
    open: offerStillApplies({
      taken,
      firstPaidAt: row?.first_paid_at ? new Date(row.first_paid_at) : null,
      paidThrough: current?.tier === 'pro' ? current.expiresAt : null,
    }),
    placesLeft: Math.max(0, DEVELOPER_OFFER_PLACES - taken),
  };
}

/** The device limit a purchase puts on the key. Older orders were sold without one. */
function deviceLimitFor(purchase: Purchase): number | undefined {
  if (purchase.legacy) return undefined;
  return purchase.plan === 'developer' ? ONE_DEVICE : NO_DEVICE_LIMIT;
}

export async function recordOrder(order: typeof razorpayOrders.$inferInsert): Promise<void> {
  await getDb().insert(razorpayOrders).values(order);
}

export async function findOrder(orderId: string): Promise<RazorpayOrderRow | null> {
  return (await getDb().query.razorpayOrders.findFirst({ where: eq(razorpayOrders.id, orderId) })) ?? null;
}

export type FulfillResult =
  | { status: 'paid'; order: RazorpayOrderRow; expiresAt: Date; licenseKey: string | null }
  | { status: 'already_paid'; order: RazorpayOrderRow }
  | { status: 'unknown_order' };

/**
 * Marks the order paid, gives the workspace the plan for another period, and keeps the buyer's
 * Shield license key paid through the same date. Only call it after the payment's signature
 * (or the webhook's) has been verified.
 */
export async function fulfillOrder(orderId: string, paymentId: string): Promise<FulfillResult> {
  return getDb().transaction(async (tx) => {
    const [order] = await tx
      .update(razorpayOrders)
      .set({ status: 'paid', paymentId, paidAt: new Date() })
      .where(and(eq(razorpayOrders.id, orderId), eq(razorpayOrders.status, 'created')))
      .returning();
    if (!order) {
      const existing = await tx.query.razorpayOrders.findFirst({ where: eq(razorpayOrders.id, orderId) });
      return existing ? { status: 'already_paid', order: existing } : { status: 'unknown_order' };
    }
    const purchase = parsePurchase(order.plan);
    if (!purchase) throw new Error(`Order ${order.id} names an unknown plan: ${order.plan}`);

    const plan = PAID_PLANS[purchase.plan];
    const limits = LICENSE_TIERS[plan.tier];
    const [row] = rowsOf<{ tier: string; expires_at: string | Date | null }>(
      await tx.execute(sql`
        SELECT tier, expires_at FROM licenses WHERE org_id = ${order.orgId} AND revoked_at IS NULL LIMIT 1 FOR UPDATE
      `),
    );
    const current = row ? { tier: String(row.tier), expiresAt: row.expires_at ? new Date(row.expires_at) : null } : null;
    const expiresAt = nextPeriodEnd(current, plan.tier, new Date(), PERIOD_DAYS[purchase.period]);

    await tx.execute(sql`
      INSERT INTO licenses (org_id, tier, max_instances, max_teams, max_users, features, activated_at, expires_at)
      VALUES (
        ${order.orgId}, ${plan.tier}, ${limits.maxInstances}, ${limits.maxTeams}, ${limits.maxUsers},
        ${JSON.stringify(limits.features)}::jsonb, NOW(), ${expiresAt.toISOString()}::timestamptz
      )
      ON CONFLICT (org_id) DO UPDATE SET
        tier = EXCLUDED.tier,
        max_instances = EXCLUDED.max_instances,
        max_teams = EXCLUDED.max_teams,
        max_users = EXCLUDED.max_users,
        features = EXCLUDED.features,
        activated_at = CASE
          WHEN licenses.tier = EXCLUDED.tier AND licenses.revoked_at IS NULL THEN licenses.activated_at
          ELSE NOW()
        END,
        expires_at = EXCLUDED.expires_at,
        revoked_at = NULL
    `);

    const user = await tx.query.users.findFirst({ where: eq(users.id, order.userId) });
    if (!user) throw new Error(`Order ${order.id} belongs to a user that no longer exists`);
    const { licenseKey } = await extendIssuedEntitlement(tx, user.email, expiresAt, deviceLimitFor(purchase));

    return { status: 'paid', order, expiresAt, licenseKey };
  });
}

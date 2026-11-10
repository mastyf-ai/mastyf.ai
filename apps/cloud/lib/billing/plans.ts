/**
 * Plans sold through Razorpay. Prices live here, on the server's side of the checkout: the
 * browser only names a plan and a billing period, so nobody can pay less by editing a request.
 * Safe to import in client components (no secrets).
 */

export type PaidPlanId = 'developer' | 'team';
export type BillingPeriod = 'monthly' | 'yearly';

/** What each billing period buys; paying again extends it. */
export const PERIOD_DAYS: Record<BillingPeriod, number> = { monthly: 30, yearly: 365 };

/** The Developer Pro launch offer goes to this many workspaces. */
export const DEVELOPER_OFFER_PLACES = 100;
/** Each workspace keeps the offer for this long after its first offer payment. */
export const DEVELOPER_OFFER_DAYS = 365;
/** Matches razorpay_orders.plan for the orders that took the offer. */
export const DEVELOPER_OFFER_CODES = 'developer:%:offer';

type Amounts = Record<BillingPeriod, number>;

export type PaidPlan = {
  name: string;
  /** licenses.tier this plan grants the workspace. */
  tier: 'pro' | 'team';
  /** In paise (₹1 = 100 paise). */
  amounts: Amounts;
  /** The launch offer's prices, for a plan that has one. */
  offerAmounts?: Amounts;
  currency: 'INR';
};

export const PAID_PLANS: Record<PaidPlanId, PaidPlan> = {
  developer: {
    name: 'Developer Pro',
    tier: 'pro',
    amounts: { monthly: 199_900, yearly: 2_099_900 },
    offerAmounts: { monthly: 99_900, yearly: 899_900 },
    currency: 'INR',
  },
  team: {
    name: 'Team',
    tier: 'team',
    amounts: { monthly: 999_900, yearly: 10_499_900 },
    currency: 'INR',
  },
};

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return value === 'developer' || value === 'team';
}

export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return value === 'monthly' || value === 'yearly';
}

/** The price in paise. `offer` only counts for a plan that has an offer. */
export function planAmount(plan: PaidPlanId, period: BillingPeriod, offer = false): number {
  const { amounts, offerAmounts } = PAID_PLANS[plan];
  return (offer && offerAmounts ? offerAmounts : amounts)[period];
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Whole rupees in Indian grouping: 104999 → "₹1,04,999". */
export function formatInr(rupees: number): string {
  return INR.format(rupees);
}

/** "₹1,999" */
export function formatPlanPrice(plan: PaidPlanId, period: BillingPeriod = 'monthly', offer = false): string {
  return formatInr(planAmount(plan, period, offer) / 100);
}

/** What an order bought. `legacy` marks an order from before yearly billing and device limits. */
export type Purchase = { plan: PaidPlanId; period: BillingPeriod; offer: boolean; legacy: boolean };

/** razorpay_orders.plan for a new order: "developer:monthly:offer", "team:yearly". */
export function purchaseCode({ plan, period, offer }: Pick<Purchase, 'plan' | 'period' | 'offer'>): string {
  return offer ? `${plan}:${period}:offer` : `${plan}:${period}`;
}

/** Reads razorpay_orders.plan back. Older orders hold just "developer" or "team" and bought 30 days. */
export function parsePurchase(code: string): Purchase | null {
  if (isPaidPlanId(code)) return { plan: code, period: 'monthly', offer: false, legacy: true };
  const [plan, period, flag, ...rest] = code.split(':');
  if (!isPaidPlanId(plan) || !isBillingPeriod(period) || rest.length > 0) return null;
  if (flag === undefined) return { plan, period, offer: false, legacy: false };
  if (flag === 'offer' && PAID_PLANS[plan].offerAmounts) return { plan, period, offer: true, legacy: false };
  return null;
}

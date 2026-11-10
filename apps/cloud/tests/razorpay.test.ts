import { createHmac } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockedByHigherPlan, nextPeriodEnd, offerStillApplies } from '@/lib/billing/fulfillment';
import { deviceDecision, entitlementActive, generateLicenseKey, licenseKeyPreview } from '@/lib/billing/license-keys';
import {
  formatPlanPrice,
  isBillingPeriod,
  isPaidPlanId,
  PAID_PLANS,
  parsePurchase,
  planAmount,
  purchaseCode,
} from '@/lib/billing/plans';
import {
  createRazorpayOrder,
  paidOrderFromEvent,
  RazorpayApiError,
  razorpayCredentials,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from '@/lib/razorpay';

const SECRET = 'test_key_secret';
const sign = (payload: string, secret = SECRET) => createHmac('sha256', secret).update(payload).digest('hex');
const DAY = 24 * 60 * 60 * 1000;

describe('payment signature', () => {
  it('accepts HMAC-SHA256(order_id|payment_id) made with the key secret', () => {
    const signature = sign('order_1|pay_1');
    expect(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature }, SECRET)).toBe(true);
  });

  it('rejects a signature for another payment, another secret, or of the wrong length', () => {
    const signature = sign('order_1|pay_1');
    expect(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_2', signature }, SECRET)).toBe(false);
    expect(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature }, 'other')).toBe(false);
    expect(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: 'abc' }, SECRET)).toBe(false);
  });

  it('checks webhooks against the raw body', () => {
    const body = '{"event":"order.paid"}';
    expect(verifyWebhookSignature(body, sign(body, 'whsec'), 'whsec')).toBe(true);
    expect(verifyWebhookSignature(`${body} `, sign(body, 'whsec'), 'whsec')).toBe(false);
  });
});

describe('webhook events', () => {
  it('reads the order and payment from order.paid and payment.captured', () => {
    expect(
      paidOrderFromEvent({
        event: 'order.paid',
        payload: { order: { entity: { id: 'order_1' } }, payment: { entity: { id: 'pay_1', order_id: 'order_1' } } },
      }),
    ).toEqual({ orderId: 'order_1', paymentId: 'pay_1' });
    expect(
      paidOrderFromEvent({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_2', order_id: 'order_2' } } } }),
    ).toEqual({ orderId: 'order_2', paymentId: 'pay_2' });
  });

  it('ignores other events', () => {
    expect(paidOrderFromEvent({ event: 'payment.failed', payload: { payment: { entity: { id: 'p', order_id: 'o' } } } })).toBeNull();
  });
});

describe('creating an order', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the amount with basic auth and returns the order', async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 'order_9', amount: 469900, currency: 'INR' }));
    vi.stubGlobal('fetch', fetchMock);

    const order = await createRazorpayOrder(
      { keyId: 'rzp_test_x', keySecret: 's' },
      { amount: 469900, currency: 'INR', receipt: 'r'.repeat(60) },
    );

    expect(order).toEqual({ id: 'order_9', amount: 469900, currency: 'INR' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('rzp_test_x:s').toString('base64')}`,
    );
    const body = JSON.parse(String(init.body));
    expect(body.amount).toBe(469900);
    expect(body.receipt).toHaveLength(40);
  });

  it('reports Razorpay errors with their status (401 for bad keys)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: { description: 'Authentication failed' } }, { status: 401 })),
    );
    const attempt = createRazorpayOrder({ keyId: 'k', keySecret: 's' }, { amount: 100, currency: 'INR', receipt: 'r' });
    await expect(attempt).rejects.toBeInstanceOf(RazorpayApiError);
    await expect(attempt).rejects.toMatchObject({ status: 401, message: 'Authentication failed' });
  });

  it('refuses amounts under 100 paise without calling Razorpay', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      createRazorpayOrder({ keyId: 'k', keySecret: 's' }, { amount: 99, currency: 'INR', receipt: 'r' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs both keys configured', () => {
    expect(razorpayCredentials({ RAZORPAY_KEY_ID: 'k' })).toBeNull();
    expect(razorpayCredentials({ RAZORPAY_KEY_ID: ' k ', RAZORPAY_KEY_SECRET: 's' })).toEqual({ keyId: 'k', keySecret: 's' });
  });
});

describe('plans', () => {
  it('prices Developer Pro: the first-100 offer, then the normal price', () => {
    expect(formatPlanPrice('developer', 'monthly', true)).toBe('₹999');
    expect(formatPlanPrice('developer', 'yearly', true)).toBe('₹8,999');
    expect(formatPlanPrice('developer', 'monthly')).toBe('₹1,999');
    expect(formatPlanPrice('developer', 'yearly')).toBe('₹20,999');
  });

  it('prices Team the same for everyone, with no offer to apply', () => {
    expect(formatPlanPrice('team', 'monthly')).toBe('₹9,999');
    expect(formatPlanPrice('team', 'yearly')).toBe('₹1,04,999');
    expect(planAmount('team', 'yearly', true)).toBe(10_499_900);
  });

  it('keeps every price above Razorpay’s minimum', () => {
    for (const plan of Object.values(PAID_PLANS)) {
      for (const amount of [...Object.values(plan.amounts), ...Object.values(plan.offerAmounts ?? {})]) {
        expect(amount).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it('only knows monthly and yearly billing', () => {
    expect(isBillingPeriod('monthly')).toBe(true);
    expect(isBillingPeriod('yearly')).toBe(true);
    expect(isBillingPeriod('weekly')).toBe(false);
    expect(isBillingPeriod(undefined)).toBe(false);
  });

  it('only knows the plans sold through checkout', () => {
    expect(isPaidPlanId('developer')).toBe(true);
    expect(isPaidPlanId('enterprise')).toBe(false);
    expect(isPaidPlanId(undefined)).toBe(false);
  });
});

describe('what an order bought', () => {
  it('records the plan, the period and whether the offer applied', () => {
    expect(purchaseCode({ plan: 'developer', period: 'yearly', offer: true })).toBe('developer:yearly:offer');
    expect(parsePurchase('developer:yearly:offer')).toEqual({ plan: 'developer', period: 'yearly', offer: true, legacy: false });
    expect(parsePurchase('team:monthly')).toEqual({ plan: 'team', period: 'monthly', offer: false, legacy: false });
  });

  it('reads orders from before yearly billing as 30 days, and marks them as older purchases', () => {
    expect(parsePurchase('developer')).toEqual({ plan: 'developer', period: 'monthly', offer: false, legacy: true });
    expect(parsePurchase('team')).toEqual({ plan: 'team', period: 'monthly', offer: false, legacy: true });
  });

  it.each(['enterprise', 'developer:weekly', 'team:monthly:offer', 'developer:monthly:free', 'developer:monthly:offer:x', ''])(
    'rejects %j',
    (code) => {
      expect(parsePurchase(code)).toBeNull();
    },
  );
});

describe('the first-100 Developer Pro offer', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  const first = new Date('2026-06-01T00:00:00Z');

  it('is open to a new workspace while places remain', () => {
    expect(offerStillApplies({ taken: 99, firstPaidAt: null, paidThrough: null }, now)).toBe(true);
    expect(offerStillApplies({ taken: 100, firstPaidAt: null, paidThrough: null }, now)).toBe(false);
  });

  it('keeps an early customer on it for 12 months, even after the places run out', () => {
    expect(offerStillApplies({ taken: 100, firstPaidAt: first, paidThrough: now }, now)).toBe(true);
  });

  it('ends 12 months after their first offer payment', () => {
    const later = new Date(first.getTime() + 366 * DAY);
    expect(offerStillApplies({ taken: 5, firstPaidAt: first, paidThrough: null }, later)).toBe(false);
  });

  it('cannot be stretched past the 12 months by paying far ahead', () => {
    const paidThrough = new Date(first.getTime() + 366 * DAY);
    expect(offerStillApplies({ taken: 5, firstPaidAt: first, paidThrough }, now)).toBe(false);
  });
});

describe('one device per Developer Pro key', () => {
  it('ties an unused key to the first device', () => {
    expect(deviceDecision({ activationLimit: 1, lemonInstanceId: null }, 'shield-a')).toBe('claim');
  });

  it('allows the device it is tied to, and no other', () => {
    expect(deviceDecision({ activationLimit: 1, lemonInstanceId: 'shield-a' }, 'shield-a')).toBe('allow');
    expect(deviceDecision({ activationLimit: 1, lemonInstanceId: 'shield-a' }, 'shield-b')).toBe('refuse');
  });

  it('does not limit keys sold without a device limit', () => {
    expect(deviceDecision({ activationLimit: 2, lemonInstanceId: 'shield-a' }, 'shield-b')).toBe('allow');
    expect(deviceDecision({ activationLimit: 2, lemonInstanceId: null }, '')).toBe('allow');
  });

  it('refuses a blank device name on a one-device key', () => {
    expect(deviceDecision({ activationLimit: 1, lemonInstanceId: null }, '')).toBe('refuse');
    expect(deviceDecision({ activationLimit: 1, lemonInstanceId: 'shield-a' }, '')).toBe('refuse');
  });
});

describe('paid periods', () => {
  const now = new Date('2026-10-20T00:00:00Z');

  it('buys a year when the purchase is yearly', () => {
    expect(nextPeriodEnd(null, 'pro', now, 365).getTime()).toBe(now.getTime() + 365 * DAY);
  });

  it('adds the year after the current period when renewing early', () => {
    const onPro = { tier: 'pro', expiresAt: new Date(now.getTime() + 10 * DAY) };
    expect(nextPeriodEnd(onPro, 'pro', now, 365).getTime()).toBe(now.getTime() + 375 * DAY);
  });

  it('starts 30 days from now for a new or different plan', () => {
    expect(nextPeriodEnd(null, 'pro', now).getTime()).toBe(now.getTime() + 30 * DAY);
    const onPro = { tier: 'pro', expiresAt: new Date(now.getTime() + 10 * DAY) };
    expect(nextPeriodEnd(onPro, 'team', now).getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it('adds 30 days after the current period when renewing early', () => {
    const onPro = { tier: 'pro', expiresAt: new Date(now.getTime() + 10 * DAY) };
    expect(nextPeriodEnd(onPro, 'pro', now).getTime()).toBe(now.getTime() + 40 * DAY);
  });

  it('starts fresh when the plan has already lapsed', () => {
    const lapsed = { tier: 'pro', expiresAt: new Date(now.getTime() - DAY) };
    expect(nextPeriodEnd(lapsed, 'pro', now).getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it('turns away a purchase that would cut short a higher running plan', () => {
    const onTeam = { tier: 'team', expiresAt: new Date(now.getTime() + DAY) };
    expect(blockedByHigherPlan(onTeam, 'pro', now)).toBe(true);
    expect(blockedByHigherPlan({ tier: 'enterprise', expiresAt: null }, 'team', now)).toBe(true);
    expect(blockedByHigherPlan({ tier: 'team', expiresAt: new Date(now.getTime() - DAY) }, 'pro', now)).toBe(false);
    expect(blockedByHigherPlan({ tier: 'pro', expiresAt: null }, 'team', now)).toBe(false);
    expect(blockedByHigherPlan(null, 'pro', now)).toBe(false);
  });
});

describe('license keys', () => {
  it('carry 140 random bits (MG- + 7 groups of 4) and do not repeat', () => {
    const keys = new Set(Array.from({ length: 200 }, generateLicenseKey));
    expect(keys.size).toBe(200);
    for (const key of keys) expect(key).toMatch(/^MG-[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){6}$/);
    expect(licenseKeyPreview('MG-AAAA-BBBB-CCCC-wxyz')).toBe('MG-****-WXYZ');
  });

  it('stay active until their paid-through time', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    expect(entitlementActive({ status: 'active', expiresAt: new Date(now.getTime() + 1) }, now)).toBe(true);
    expect(entitlementActive({ status: 'active', expiresAt: new Date(now.getTime() - 1) }, now)).toBe(false);
    expect(entitlementActive({ status: 'disabled', expiresAt: null }, now)).toBe(false);
    // Lemon Squeezy keys carry no expiry here.
    expect(entitlementActive({ status: 'active', expiresAt: null }, now)).toBe(true);
  });
});

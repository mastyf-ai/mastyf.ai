import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { safeAuth, getUserOrg, currentLicense, developerOfferFor, recordOrder, findOrder, fulfillOrder } = vi.hoisted(() => ({
  safeAuth: vi.fn(),
  developerOfferFor: vi.fn(),
  getUserOrg: vi.fn(),
  currentLicense: vi.fn(),
  recordOrder: vi.fn(),
  findOrder: vi.fn(),
  fulfillOrder: vi.fn(),
}));

vi.mock('@/lib/safe-auth', () => ({ safeAuth }));
vi.mock('@/lib/org-context', () => ({
  getUserOrg,
  userCanManageOrg: (m: { role: string }) => m.role === 'owner' || m.role === 'admin',
}));
vi.mock('@/lib/billing/fulfillment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/fulfillment')>()),
  currentLicense,
  developerOfferFor,
  recordOrder,
  findOrder,
  fulfillOrder,
}));

import { POST as createOrder } from '@/app/api/billing/create-order/route';
import { POST as verifyPayment } from '@/app/api/billing/verify-payment/route';
import { POST as razorpayWebhook } from '@/app/api/webhooks/razorpay/route';

const KEY_SECRET = 'test_key_secret';
const sign = (payload: string, secret = KEY_SECRET) => createHmac('sha256', secret).update(payload).digest('hex');

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost:3001/api/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const SESSION = { user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' } };
const CTX = { org: { id: 'org-1' }, membership: { role: 'owner' } };
const ORDER = { id: 'order_1', userId: 'user-1', orgId: 'org-1', plan: 'developer', status: 'created' };

beforeEach(() => {
  vi.resetAllMocks();
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
  safeAuth.mockResolvedValue(SESSION);
  getUserOrg.mockResolvedValue(CTX);
  currentLicense.mockResolvedValue(null);
  developerOfferFor.mockResolvedValue({ open: true, placesLeft: 100 });
});

/** Razorpay echoes what it was asked to charge; returns the request body it received. */
function stubRazorpay() {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const sent = JSON.parse(String(init.body)) as { amount: number };
    return Response.json({ id: 'order_1', amount: sent.amount, currency: 'INR' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return () => JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/billing/create-order', () => {
  it('is 401 when nobody is signed in', async () => {
    safeAuth.mockResolvedValue(null);
    expect((await createOrder(post({ plan: 'developer' }))).status).toBe(401);
  });

  it('is 400 for an unknown plan', async () => {
    expect((await createOrder(post({ plan: 'enterprise' }))).status).toBe(400);
  });

  it('is 503 when Razorpay keys are not configured', async () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    expect((await createOrder(post({ plan: 'developer' }))).status).toBe(503);
  });

  it('only lets workspace owners and admins buy', async () => {
    getUserOrg.mockResolvedValue({ ...CTX, membership: { role: 'viewer' } });
    expect((await createOrder(post({ plan: 'developer' }))).status).toBe(403);
  });

  it('will not sell a lower plan over a higher one that is still running', async () => {
    currentLicense.mockResolvedValue({ tier: 'team', expiresAt: new Date(Date.now() + 86_400_000) });
    expect((await createOrder(post({ plan: 'developer' }))).status).toBe(409);
  });

  it('charges the server-side price, whatever amount the browser sends, and records the order', async () => {
    const sent = stubRazorpay();

    const res = await createOrder(post({ plan: 'developer', amount: 100 }));

    expect(res.status).toBe(200);
    expect(sent().amount).toBe(99900);
    expect(recordOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order_1', userId: 'user-1', orgId: 'org-1', plan: 'developer:monthly:offer', amount: 99900 }),
    );
    const body = await res.json();
    expect(body).toMatchObject({ orderId: 'order_1', amount: 99900, currency: 'INR', keyId: 'rzp_test_key' });
    expect(JSON.stringify(body)).not.toContain(KEY_SECRET);
  });

  it('charges the yearly offer price while places remain', async () => {
    const sent = stubRazorpay();
    const res = await createOrder(post({ plan: 'developer', period: 'yearly' }));
    expect(sent().amount).toBe(899900);
    expect(recordOrder).toHaveBeenCalledWith(expect.objectContaining({ plan: 'developer:yearly:offer', amount: 899900 }));
    expect((await res.json()).plan).toMatchObject({ id: 'developer', period: 'yearly' });
  });

  it('checks the offer against this workspace and its current plan', async () => {
    stubRazorpay();
    const license = { tier: 'pro', expiresAt: new Date(Date.now() + 86_400_000) };
    currentLicense.mockResolvedValue(license);
    await createOrder(post({ plan: 'developer' }));
    expect(developerOfferFor).toHaveBeenCalledWith('org-1', license);
  });

  it('charges the normal price once the offer has closed, even if the browser asks for the offer', async () => {
    developerOfferFor.mockResolvedValue({ open: false, placesLeft: 0 });
    const sent = stubRazorpay();
    await createOrder(post({ plan: 'developer', offer: true }));
    expect(sent().amount).toBe(199900);
    expect(recordOrder).toHaveBeenCalledWith(expect.objectContaining({ plan: 'developer:monthly', amount: 199900 }));
  });

  it('charges the normal yearly price once the offer has closed', async () => {
    developerOfferFor.mockResolvedValue({ open: false, placesLeft: 0 });
    const sent = stubRazorpay();
    await createOrder(post({ plan: 'developer', period: 'yearly' }));
    expect(sent().amount).toBe(2099900);
  });

  it.each([
    ['monthly', 999900],
    ['yearly', 10499900],
  ])('charges Team %s at its one price, with no offer involved', async (period, amount) => {
    const sent = stubRazorpay();
    await createOrder(post({ plan: 'team', period }));
    expect(sent().amount).toBe(amount);
    expect(recordOrder).toHaveBeenCalledWith(expect.objectContaining({ plan: `team:${period}`, amount }));
    expect(developerOfferFor).not.toHaveBeenCalled();
  });

  it('is 400 for a billing period it does not sell', async () => {
    expect((await createOrder(post({ plan: 'developer', period: 'weekly' }))).status).toBe(400);
  });

  it('is 500 when Razorpay rejects the request, without recording an order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { description: 'bad' } }, { status: 401 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await createOrder(post({ plan: 'team' }))).status).toBe(500);
    expect(recordOrder).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/verify-payment', () => {
  const paid = (signature = sign('order_1|pay_1')) => ({
    razorpay_order_id: 'order_1',
    razorpay_payment_id: 'pay_1',
    razorpay_signature: signature,
  });

  it('is 401 when nobody is signed in', async () => {
    safeAuth.mockResolvedValue(null);
    expect((await verifyPayment(post(paid()))).status).toBe(401);
  });

  it('is 400 when a field is missing', async () => {
    expect((await verifyPayment(post({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1' }))).status).toBe(400);
  });

  it('is 400 on a signature mismatch, and grants nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await verifyPayment(post(paid(sign('order_1|pay_1', 'wrong-secret'))));
    expect(res.status).toBe(400);
    expect(fulfillOrder).not.toHaveBeenCalled();
  });

  it("is 403 for someone else's order, without fulfilling it for them", async () => {
    findOrder.mockResolvedValue({ ...ORDER, userId: 'someone-else' });
    expect((await verifyPayment(post(paid()))).status).toBe(403);
    expect(fulfillOrder).not.toHaveBeenCalled();
  });

  it('activates the plan and returns the new license key once', async () => {
    findOrder.mockResolvedValue(ORDER);
    const expiresAt = new Date('2026-11-19T00:00:00Z');
    fulfillOrder.mockResolvedValue({ status: 'paid', order: ORDER, expiresAt, licenseKey: 'MG-AAAA-BBBB-CCCC-DDDD' });

    const res = await verifyPayment(post(paid()));

    expect(res.status).toBe(200);
    expect(fulfillOrder).toHaveBeenCalledWith('order_1', 'pay_1');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({
      paid: true,
      plan: 'developer',
      expiresAt: expiresAt.toISOString(),
      licenseKey: 'MG-AAAA-BBBB-CCCC-DDDD',
    });
  });

  it('tells the buyer when the offer ended before their payment arrived', async () => {
    findOrder.mockResolvedValue(ORDER);
    fulfillOrder.mockResolvedValue({
      status: 'paid',
      order: ORDER,
      expiresAt: new Date('2026-11-24T00:00:00Z'),
      licenseKey: null,
      offerEnded: true,
      days: 14,
    });
    expect((await (await verifyPayment(post(paid()))).json()).offerEndedDays).toBe(14);
  });

  it('is idempotent when the webhook got there first', async () => {
    findOrder.mockResolvedValue({ ...ORDER, status: 'paid' });
    fulfillOrder.mockResolvedValue({ status: 'already_paid', order: { ...ORDER, status: 'paid' } });
    const res = await verifyPayment(post(paid()));
    expect(res.status).toBe(200);
    expect((await res.json()).licenseKey).toBeNull();
  });
});

describe('POST /api/webhooks/razorpay', () => {
  const event = JSON.stringify({
    event: 'order.paid',
    payload: { order: { entity: { id: 'order_1' } }, payment: { entity: { id: 'pay_1', order_id: 'order_1' } } },
  });

  it('is 400 for a bad signature', async () => {
    const res = await razorpayWebhook(post(event, { 'x-razorpay-signature': sign(event, 'nope') }));
    expect(res.status).toBe(400);
    expect(fulfillOrder).not.toHaveBeenCalled();
  });

  it('fulfils a signed order.paid event', async () => {
    fulfillOrder.mockResolvedValue({ status: 'paid', order: ORDER, expiresAt: new Date(), licenseKey: 'MG-X' });
    const res = await razorpayWebhook(post(event, { 'x-razorpay-signature': sign(event, 'whsec') }));
    expect(res.status).toBe(200);
    expect(fulfillOrder).toHaveBeenCalledWith('order_1', 'pay_1');
    expect(JSON.stringify(await res.json())).not.toContain('MG-X');
  });

  it('acknowledges events it does not act on', async () => {
    const other = JSON.stringify({ event: 'refund.created', payload: {} });
    const res = await razorpayWebhook(post(other, { 'x-razorpay-signature': sign(other, 'whsec') }));
    expect(res.status).toBe(200);
    expect(fulfillOrder).not.toHaveBeenCalled();
  });

  it('is 500 (so Razorpay retries) when the secret is missing', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await razorpayWebhook(post(event, { 'x-razorpay-signature': 'x' }))).status).toBe(500);
  });
});

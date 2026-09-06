import { describe, expect, it, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import {
  verifyLemonSqueezySignature,
  hashPayload,
  isTransitionAllowed,
  isSubscriptionEntitled,
  parseSubscriptionEvent,
  parseLicenseKeyCreated,
  LemonSqueezyWebhookPayload,
} from '../lib/lemonsqueezy-webhook';
import { POST } from '../app/api/webhooks/lemonsqueezy/route';

const TEST_SECRET = 'test_webhook_secret_key_12345';

function signBody(body: string, secret: string = TEST_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('Lemon Squeezy Webhook & Entitlement System', () => {
  beforeEach(() => {
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = TEST_SECRET;
    delete process.env.DATABASE_URL;
  });

  describe('1. Raw-Body Signature Verification', () => {
    it('accepts correct HMAC-SHA256 signature', () => {
      const body = JSON.stringify({ test: 'data' });
      const sig = signBody(body);
      expect(verifyLemonSqueezySignature(body, sig, TEST_SECRET)).toBe(true);
    });

    it('rejects tampered body or invalid signature', () => {
      const body = JSON.stringify({ test: 'data' });
      const sig = signBody(body);
      const tampered = JSON.stringify({ test: 'data', evil: true });
      expect(verifyLemonSqueezySignature(tampered, sig, TEST_SECRET)).toBe(false);
      expect(verifyLemonSqueezySignature(body, 'invalid_sig', TEST_SECRET)).toBe(false);
    });

    it('rejects missing signature or secret', () => {
      const body = JSON.stringify({ test: 'data' });
      expect(verifyLemonSqueezySignature(body, null, TEST_SECRET)).toBe(false);
      expect(verifyLemonSqueezySignature(body, 'sig', '')).toBe(false);
    });
  });

  describe('2. Monotonic State Machine & Out-of-Order Event Protection', () => {
    const t0 = new Date('2026-09-01T12:00:00Z');
    const t1 = new Date('2026-09-02T12:00:00Z');
    const t2 = new Date('2026-09-03T12:00:00Z');

    it('allows transitions with newer timestamps', () => {
      const check = isTransitionAllowed({
        existingStatus: 'active',
        incomingStatus: 'cancelled',
        existingLemonUpdatedAt: t0,
        incomingLemonUpdatedAt: t1,
      });
      expect(check.allowed).toBe(true);
    });

    it('rejects out-of-order events where incoming timestamp is older than recorded state', () => {
      const check = isTransitionAllowed({
        existingStatus: 'cancelled',
        incomingStatus: 'active',
        existingLemonUpdatedAt: t2,
        incomingLemonUpdatedAt: t1, // older than t2!
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Out-of-order event rejected');
    });

    it('prevents terminal expired state from being resurrected by stale active event', () => {
      const periodEnd = new Date('2026-09-30T00:00:00Z');
      const check = isTransitionAllowed({
        existingStatus: 'expired',
        incomingStatus: 'active',
        existingLemonUpdatedAt: t1,
        incomingLemonUpdatedAt: t2,
        existingPeriodEnd: periodEnd,
        incomingPeriodEnd: periodEnd, // Same period end -> not a new billing renewal
      });
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Cannot resurrect expired subscription without a newer billing period');
    });

    it('allows expired state to be resurrected by genuine new billing renewal', () => {
      const oldPeriodEnd = new Date('2026-09-30T00:00:00Z');
      const newPeriodEnd = new Date('2026-10-31T00:00:00Z');
      const check = isTransitionAllowed({
        existingStatus: 'expired',
        incomingStatus: 'active',
        existingLemonUpdatedAt: t1,
        incomingLemonUpdatedAt: t2,
        existingPeriodEnd: oldPeriodEnd,
        incomingPeriodEnd: newPeriodEnd, // New billing renewal!
      });
      expect(check.allowed).toBe(true);
    });
  });

  describe('3. Commercial Entitlement Validity Rules', () => {
    it('grants active entitlement to active and on_trial subscriptions', () => {
      expect(isSubscriptionEntitled({ status: 'active' })).toBe(true);
      expect(isSubscriptionEntitled({ status: 'on_trial' })).toBe(true);
    });

    it('preserves access for cancelled subscriptions until paid endsAt date', () => {
      const futureEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days in future
      const pastEndsAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days in past

      // Within paid period: access is PRESERVED
      expect(isSubscriptionEntitled({
        status: 'cancelled',
        endsAt: futureEndsAt,
      })).toBe(true);

      // After paid period ends: access is EXPIRED
      expect(isSubscriptionEntitled({
        status: 'cancelled',
        endsAt: pastEndsAt,
      })).toBe(false);
    });

    it('allows 7-day grace period on past_due before expiring', () => {
      const periodEnd = new Date('2026-09-10T00:00:00Z');

      // 3 days after periodEnd: inside 7-day grace period
      const duringGrace = new Date('2026-09-13T00:00:00Z');
      expect(isSubscriptionEntitled({
        status: 'past_due',
        currentPeriodEnd: periodEnd,
        now: duringGrace,
      })).toBe(true);

      // 10 days after periodEnd: beyond 7-day grace period
      const afterGrace = new Date('2026-09-20T00:00:00Z');
      expect(isSubscriptionEntitled({
        status: 'past_due',
        currentPeriodEnd: periodEnd,
        now: afterGrace,
      })).toBe(false);
    });

    it('revokes access immediately on expired subscriptions', () => {
      expect(isSubscriptionEntitled({ status: 'expired' })).toBe(false);
      expect(isSubscriptionEntitled({ status: 'paused' })).toBe(false);
      expect(isSubscriptionEntitled({ status: 'unpaid' })).toBe(false);
    });
  });

  describe('4. Webhook Payload Extraction', () => {
    it('parses subscription payload attributes accurately', () => {
      const payload: LemonSqueezyWebhookPayload = {
        meta: {
          event_name: 'subscription_created',
          custom_data: { hf_username: 'researcher123' },
        },
        data: {
          type: 'subscriptions',
          id: 'sub_998877',
          attributes: {
            user_email: 'Customer@example.com ',
            customer_id: 45678,
            status: 'active',
            product_id: 111,
            variant_id: 222,
            created_at: '2026-09-01T10:00:00Z',
            renews_at: '2026-10-01T10:00:00Z',
            updated_at: '2026-09-01T10:00:00Z',
          },
        },
      };

      const parsed = parseSubscriptionEvent(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.lemonSubscriptionId).toBe('sub_998877');
      expect(parsed?.lemonCustomerId).toBe('45678');
      expect(parsed?.userEmail).toBe('customer@example.com');
      expect(parsed?.status).toBe('active');
      expect(parsed?.currentPeriodEnd).toEqual(new Date('2026-10-01T10:00:00Z'));
      expect(parsed?.customData?.hf_username).toBe('researcher123');
    });

    it('parses license key created payload', () => {
      const payload: LemonSqueezyWebhookPayload = {
        meta: { event_name: 'license_key_created' },
        data: {
          type: 'license-keys',
          id: 'lic_12345',
          attributes: {
            key: 'MG-PRO-XXXX-YYYY',
            user_email: 'buyer@example.com',
            order_id: 999,
            subscription_id: 'sub_998877',
            status: 'active',
            activation_limit: 2,
            instances_count: 0,
            created_at: '2026-09-01T10:00:00Z',
          },
        },
      };

      const parsed = parseLicenseKeyCreated(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.key).toBe('MG-PRO-XXXX-YYYY');
      expect(parsed?.lemonLicenseId).toBe('lic_12345');
      expect(parsed?.lemonSubscriptionId).toBe('sub_998877');
      expect(parsed?.activationLimit).toBe(2);
    });
  });

  describe('5. Webhook HTTP Route Handler', () => {
    it('rejects requests with missing or invalid signature', async () => {
      const body = JSON.stringify({ meta: { event_name: 'test' } });

      // Missing signature
      const resMissing = await POST(new Request('http://localhost/api/webhooks/lemonsqueezy', {
        method: 'POST',
        body,
      }));
      expect(resMissing.status).toBe(401);

      // Invalid signature
      const resBad = await POST(new Request('http://localhost/api/webhooks/lemonsqueezy', {
        method: 'POST',
        headers: { 'x-signature': 'bad_sig' },
        body,
      }));
      expect(resBad.status).toBe(401);
    });

    it('accepts valid subscription_created request', async () => {
      const payload: LemonSqueezyWebhookPayload = {
        meta: { event_name: 'subscription_created' },
        data: {
          type: 'subscriptions',
          id: 'sub_test_001',
          attributes: {
            user_email: 'developer@example.com',
            status: 'active',
            created_at: '2026-09-01T10:00:00Z',
          },
        },
      };

      const body = JSON.stringify(payload);
      const signature = signBody(body);

      const res = await POST(new Request('http://localhost/api/webhooks/lemonsqueezy', {
        method: 'POST',
        headers: {
          'x-signature': signature,
          'x-event-name': 'subscription_created',
        },
        body,
      }));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.received).toBe(true);
      expect(data.eventName).toBe('subscription_created');
    });

    it('accepts valid license_key_created request', async () => {
      const payload: LemonSqueezyWebhookPayload = {
        meta: { event_name: 'license_key_created' },
        data: {
          type: 'license-keys',
          id: 'lic_test_001',
          attributes: {
            key: 'MG-PRO-KEY-1111',
            user_email: 'developer@example.com',
            status: 'active',
          },
        },
      };

      const body = JSON.stringify(payload);
      const signature = signBody(body);

      const res = await POST(new Request('http://localhost/api/webhooks/lemonsqueezy', {
        method: 'POST',
        headers: {
          'x-signature': signature,
          'x-event-name': 'license_key_created',
        },
        body,
      }));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.received).toBe(true);
      expect(data.eventName).toBe('license_key_created');
    });
  });
});

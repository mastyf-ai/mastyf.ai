import { describe, expect, it, beforeEach } from 'vitest';
import { grantHFAccess, cancelHFAccess } from '../lib/hf-gating';
import { isTransitionAllowed, isSubscriptionEntitled } from '../lib/lemonsqueezy-webhook';

describe('Phase 2: Hugging Face Gated Model Access & Identity Binding', () => {
  const TEST_REPO = 'Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened';

  beforeEach(() => {
    process.env.HF_ACCESS_TOKEN = 'hf_mock_token_for_tests';
  });

  describe('1. HF API Direct Operations & Error Classification', () => {
    it('grants access successfully for valid user (200 OK)', async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ status: 'accepted' }), { status: 200 });

      const res = await grantHFAccess({
        hfUsername: 'researcher123',
        repoId: TEST_REPO,
        fetchFn: mockFetch as any,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('granted');
      expect(res.retryable).toBe(false);
      expect(res.message).toContain('Successfully granted');
    });

    it('handles already-authorized user idempotently (400 Bad Request with "already")', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({ message: 'User already has access to repository' }),
          { status: 400 },
        );

      const res = await grantHFAccess({
        hfUsername: 'researcher123',
        repoId: TEST_REPO,
        fetchFn: mockFetch as any,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('granted');
      expect(res.retryable).toBe(false);
      expect(res.message).toContain('already has access');
    });

    it('classifies unknown HF user as actionable failure (404 Not Found)', async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ message: 'User not found' }), {
          status: 404,
        });

      const res = await grantHFAccess({
        hfUsername: 'nonexistent_user_xyz',
        repoId: TEST_REPO,
        fetchFn: mockFetch as any,
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('invalid_hf_user');
      expect(res.retryable).toBe(false);
      expect(res.message).toContain("does not exist");
    });

    it('classifies 429 Rate Limit as retryable failure', async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
          status: 429,
        });

      const res = await grantHFAccess({
        hfUsername: 'researcher123',
        repoId: TEST_REPO,
        fetchFn: mockFetch as any,
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('rate_limited');
      expect(res.retryable).toBe(true);
    });

    it('classifies 5xx Server Error as retryable failure', async () => {
      const mockFetch = async () =>
        new Response('Internal Server Error', { status: 502 });

      const res = await grantHFAccess({
        hfUsername: 'researcher123',
        repoId: TEST_REPO,
        fetchFn: mockFetch as any,
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('sync_error');
      expect(res.retryable).toBe(true);
      expect(res.message).toContain('HTTP 502');
    });

    it('classifies insufficient token permission (403 Forbidden) as non-retryable fail-closed', async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 });

      const res = await grantHFAccess({
        hfUsername: 'researcher123',
        repoId: TEST_REPO,
        fetchFn: mockFetch as any,
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('permission_denied');
      expect(res.retryable).toBe(false);
      expect(res.message).toContain('lacks permission');
    });

    it('cancels/revokes gated access successfully (200 OK)', async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ status: 'rejected' }), { status: 200 });

      const res = await cancelHFAccess({
        hfUsername: 'researcher123',
        repoId: TEST_REPO,
        fetchFn: mockFetch as any,
      });

      expect(res.success).toBe(true);
      expect(res.message).toContain('revoked');
    });
  });

  describe('2. Commercial Gating & Identity Binding Invariants', () => {
    it('allows model access grant for active subscriptions', () => {
      expect(isSubscriptionEntitled({ status: 'active' })).toBe(true);
    });

    it('allows model access grant for cancelled-but-paid subscriptions (now <= endsAt)', () => {
      const futureEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      expect(
        isSubscriptionEntitled({
          status: 'cancelled',
          endsAt: futureEndsAt,
        }),
      ).toBe(true);
    });

    it('blocks model access grant for expired subscriptions', () => {
      expect(isSubscriptionEntitled({ status: 'expired' })).toBe(false);
    });

    it('blocks model access grant for past-grace past_due subscriptions', () => {
      const oldPeriodEnd = new Date('2026-08-01T00:00:00Z');
      const now = new Date('2026-08-20T00:00:00Z'); // 19 days past
      expect(
        isSubscriptionEntitled({
          status: 'past_due',
          currentPeriodEnd: oldPeriodEnd,
          now,
        }),
      ).toBe(false);
    });
  });

  describe('3. Permanent Identity Binding Rules (Mock Simulation)', () => {
    // In-memory model of permanent binding rules to verify invariants
    type BindingStore = {
      licenseToUser: Map<string, string>;
      userToCustomer: Map<string, string>;
    };

    function simulateBinding(
      store: BindingStore,
      opts: { licenseKey: string; customerId: string; hfUsername: string },
    ): { allowed: boolean; status: number; message?: string } {
      const existingUser = store.licenseToUser.get(opts.licenseKey);
      if (existingUser && existingUser !== opts.hfUsername) {
        return {
          allowed: false,
          status: 409,
          message: `License is already permanently bound to @${existingUser}. Re-binding to a different account is prohibited.`,
        };
      }

      const existingCust = store.userToCustomer.get(opts.hfUsername);
      if (existingCust && existingCust !== opts.customerId) {
        return {
          allowed: false,
          status: 409,
          message: `Hugging Face username @${opts.hfUsername} is already bound to another customer.`,
        };
      }

      // Valid binding
      store.licenseToUser.set(opts.licenseKey, opts.hfUsername);
      store.userToCustomer.set(opts.hfUsername, opts.customerId);
      return { allowed: true, status: 200 };
    }

    it('allows initial permanent binding of license to HF user', () => {
      const store: BindingStore = {
        licenseToUser: new Map(),
        userToCustomer: new Map(),
      };

      const res = simulateBinding(store, {
        licenseKey: 'MG-KEY-1',
        customerId: 'cust_A',
        hfUsername: 'researcher1',
      });

      expect(res.allowed).toBe(true);
      expect(res.status).toBe(200);
    });

    it('allows idempotent re-verification with the exact same HF user', () => {
      const store: BindingStore = {
        licenseToUser: new Map([['MG-KEY-1', 'researcher1']]),
        userToCustomer: new Map([['researcher1', 'cust_A']]),
      };

      const res = simulateBinding(store, {
        licenseKey: 'MG-KEY-1',
        customerId: 'cust_A',
        hfUsername: 'researcher1',
      });

      expect(res.allowed).toBe(true);
      expect(res.status).toBe(200);
    });

    it('blocks attempting to use the same license with a different HF user (409 Conflict)', () => {
      const store: BindingStore = {
        licenseToUser: new Map([['MG-KEY-1', 'researcher1']]),
        userToCustomer: new Map([['researcher1', 'cust_A']]),
      };

      const res = simulateBinding(store, {
        licenseKey: 'MG-KEY-1',
        customerId: 'cust_A',
        hfUsername: 'unauthorized_friend',
      });

      expect(res.allowed).toBe(false);
      expect(res.status).toBe(409);
      expect(res.message).toContain('permanently bound to @researcher1');
    });

    it('blocks claiming an HF username already bound to another customer (409 Conflict)', () => {
      const store: BindingStore = {
        licenseToUser: new Map([['MG-KEY-1', 'researcher1']]),
        userToCustomer: new Map([['researcher1', 'cust_A']]),
      };

      const res = simulateBinding(store, {
        licenseKey: 'MG-KEY-2',
        customerId: 'cust_B', // Different customer trying to claim researcher1!
        hfUsername: 'researcher1',
      });

      expect(res.allowed).toBe(false);
      expect(res.status).toBe(409);
      expect(res.message).toContain('already bound to another customer');
    });
  });

  describe('4. Deterministic Equal-Timestamp Tie-Breaker', () => {
    const tSame = new Date('2026-09-05T12:00:00Z');

    it('prevents downgrading cancelled to active on identical timestamps', () => {
      const check = isTransitionAllowed({
        existingStatus: 'cancelled',
        incomingStatus: 'active',
        existingLemonUpdatedAt: tSame,
        incomingLemonUpdatedAt: tSame,
      });

      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Equal timestamp tie-breaker');
    });

    it('prevents downgrading expired to active on identical timestamps', () => {
      const check = isTransitionAllowed({
        existingStatus: 'expired',
        incomingStatus: 'active',
        existingLemonUpdatedAt: tSame,
        incomingLemonUpdatedAt: tSame,
      });

      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Equal timestamp tie-breaker');
    });

    it('allows escalating from active to cancelled on identical timestamps', () => {
      const check = isTransitionAllowed({
        existingStatus: 'active',
        incomingStatus: 'cancelled',
        existingLemonUpdatedAt: tSame,
        incomingLemonUpdatedAt: tSame,
      });

      expect(check.allowed).toBe(true);
    });
  });
});

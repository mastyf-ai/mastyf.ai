import { describe, expect, it, beforeEach } from 'vitest';
import {
  activateLemonLicense,
  validateLemonLicense,
  deactivateLemonLicense,
} from '../lib/lemon-license-client';
import {
  signEntitlement,
  verifyEntitlement,
  canonicalizeEntitlement,
  DEFAULT_KEY_ID,
  PREVIOUS_KEY_ID,
  SignedEntitlement,
} from '../lib/ed25519-signer';

describe('Phase 3: Activation, Lemon Squeezy Instances, and Ed25519 Cryptography', () => {
  describe('1. Lemon Squeezy License Instance API Client', () => {
    it('activates valid license and creates instance ID', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            activated: true,
            valid: true,
            license_key: {
              id: 12345,
              status: 'active',
              user_email: 'customer@example.com',
              expires_at: '2026-10-01T00:00:00Z',
              activation_limit: 2,
              instances_count: 1,
            },
            instance: {
              id: 'inst_abc123',
              name: 'node-01',
            },
            meta: {
              store_id: 99,
              product_id: 101,
              variant_id: 202,
              customer_email: 'customer@example.com',
            },
          }),
          { status: 200 },
        );

      const res = await activateLemonLicense({
        licenseKey: 'MG-PRO-VALID-KEY',
        instanceName: 'node-01',
        expectedStoreId: '99',
        expectedProductId: '101',
        expectedVariantId: '202',
        fetchFn: mockFetch as any,
      });

      expect(res.valid).toBe(true);
      expect(res.status).toBe('active');
      expect(res.instanceId).toBe('inst_abc123');
      expect(res.licenseKeyId).toBe('12345');
      expect(res.customerEmail).toBe('customer@example.com');
    });

    it('blocks activation when product ID does not match Mastyf Guard Pro', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            activated: true,
            valid: true,
            license_key: { id: 12345, status: 'active' },
            instance: { id: 'inst_abc123' },
            meta: { product_id: 999 }, // Foreign product!
          }),
          { status: 200 },
        );

      const res = await activateLemonLicense({
        licenseKey: 'FOREIGN-PRODUCT-KEY',
        expectedProductId: '101', // Expected Mastyf Guard Pro
        fetchFn: mockFetch as any,
      });

      expect(res.valid).toBe(false);
      expect(res.status).toBe('mismatch');
      expect(res.message).toContain('unexpected product ID');
    });

    it('blocks activation when variant ID does not match expected plan', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            activated: true,
            valid: true,
            license_key: { id: 12345, status: 'active' },
            instance: { id: 'inst_abc123' },
            meta: { variant_id: 999 }, // Unexpected variant
          }),
          { status: 200 },
        );

      const res = await activateLemonLicense({
        licenseKey: 'WRONG-VARIANT-KEY',
        expectedVariantId: '202',
        fetchFn: mockFetch as any,
      });

      expect(res.valid).toBe(false);
      expect(res.status).toBe('mismatch');
      expect(res.message).toContain('unexpected variant ID');
    });

    it('blocks activation for expired or disabled licenses', async () => {
      const mockFetchExpired = async () =>
        new Response(
          JSON.stringify({
            activated: false,
            valid: false,
            error: 'License key has expired',
          }),
          { status: 200 },
        );

      const resExpired = await activateLemonLicense({
        licenseKey: 'EXPIRED-KEY',
        fetchFn: mockFetchExpired as any,
      });

      expect(resExpired.valid).toBe(false);
      expect(resExpired.status).toBe('expired');

      const mockFetchDisabled = async () =>
        new Response(
          JSON.stringify({
            activated: false,
            valid: false,
            error: 'License key is disabled',
          }),
          { status: 200 },
        );

      const resDisabled = await activateLemonLicense({
        licenseKey: 'DISABLED-KEY',
        fetchFn: mockFetchDisabled as any,
      });

      expect(resDisabled.valid).toBe(false);
      expect(resDisabled.status).toBe('disabled');
    });

    it('handles 429 rate limits gracefully', async () => {
      const mockFetch429 = async () =>
        new Response('Too Many Requests', { status: 429 });

      const res = await activateLemonLicense({
        licenseKey: 'ANY-KEY',
        fetchFn: mockFetch429 as any,
      });

      expect(res.valid).toBe(false);
      expect(res.status).toBe('rate_limited');
      expect(res.message).toContain('rate limit exceeded');
    });

    it('validates an active instance', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            valid: true,
            instance: { id: 'inst_abc123' },
            license_key: { instances_count: 1 },
          }),
          { status: 200 },
        );

      const res = await validateLemonLicense({
        licenseKey: 'MG-PRO-KEY',
        instanceId: 'inst_abc123',
        fetchFn: mockFetch as any,
      });

      expect(res.valid).toBe(true);
      expect(res.status).toBe('active');
      expect(res.instanceId).toBe('inst_abc123');
    });

    it('deactivates an active instance', async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ deactivated: true }), { status: 200 });

      const res = await deactivateLemonLicense({
        licenseKey: 'MG-PRO-KEY',
        instanceId: 'inst_abc123',
        fetchFn: mockFetch as any,
      });

      expect(res.success).toBe(true);
    });
  });

  describe('2. Asymmetric Ed25519 Entitlement Signer & Verifier', () => {
    const basePayload = {
      schema: 1 as const,
      product: 'mastyf-guard-pro' as const,
      license_id: 'lic_12345',
      instance_id: 'inst_abc123',
      activation_id: 'act_xyz789',
      model_repo: 'Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened',
      model_revision: 'd59a6aa01f9139dff106146addb04109afa69c03',
      gateway_version: '0.1.1',
      issued_at: '2026-09-06T04:30:00Z',
      expires_at: '2026-10-06T04:30:00Z',
      grace_until: '2026-10-13T04:30:00Z',
    };

    it('signs and verifies valid Ed25519 entitlement token', () => {
      const signed = signEntitlement(basePayload, DEFAULT_KEY_ID);
      expect(signed.signature).toBeTruthy();
      expect(signed.key_id).toBe(DEFAULT_KEY_ID);

      const verification = verifyEntitlement(signed);
      expect(verification.valid).toBe(true);
    });

    it('produces zero PII in the signed entitlement payload', () => {
      const signed = signEntitlement(basePayload);
      const keys = Object.keys(signed);
      expect(keys).not.toContain('customer_email');
      expect(keys).not.toContain('email');
      expect(keys).not.toContain('user_name');
      expect(keys).not.toContain('hf_username');
    });

    it('rejects tampered entitlement payload', () => {
      const signed = signEntitlement(basePayload);
      const tampered: SignedEntitlement = {
        ...signed,
        expires_at: '2030-01-01T00:00:00Z', // Tampered date!
      };

      const verification = verifyEntitlement(tampered);
      expect(verification.valid).toBe(false);
      expect(verification.reason).toContain('verification failed');
    });

    it('rejects unknown or untrusted key_id', () => {
      const signed = signEntitlement(basePayload);
      const forgedKey: SignedEntitlement = {
        ...signed,
        key_id: 'attacker-untrusted-key-2026',
      };

      const verification = verifyEntitlement(forgedKey);
      expect(verification.valid).toBe(false);
      expect(verification.reason).toContain('Unknown or untrusted key_id');
    });

    it('canonicalizeEntitlement produces deterministic JSON regardless of key insertion order', () => {
      const objA = { ...basePayload, key_id: DEFAULT_KEY_ID };
      // Reverse order of keys
      const objB: any = {};
      Object.keys(objA)
        .reverse()
        .forEach((k) => {
          objB[k] = (objA as any)[k];
        });

      expect(canonicalizeEntitlement(objA)).toBe(canonicalizeEntitlement(objB));
    });
  });

  describe('3. Entitlement Renewal Endpoint Handler', () => {
    it('renews an active license token', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            valid: true,
            instance: { id: 'inst_abc123' },
            license_key: { instances_count: 1 },
          }),
          { status: 200 },
        );

      try {
        const { POST: renewPOST } = await import('../app/api/v1/license/renew/route');
        const payload = {
          licenseKey: 'MG-PRO-ACTIVE-KEY',
          instanceId: 'inst_abc123',
        };

        const res = await renewPOST(
          new Request('http://localhost/api/v1/license/renew', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        );

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.entitlement).toBeTruthy();
        expect(data.entitlement.key_id).toBe(DEFAULT_KEY_ID);

        const verifyCheck = verifyEntitlement(data.entitlement);
        expect(verifyCheck.valid).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('rejects renewal request when licenseKey is missing', async () => {
      const { POST: renewPOST } = await import('../app/api/v1/license/renew/route');
      const res = await renewPOST(
        new Request('http://localhost/api/v1/license/renew', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(400);
    });
  });
});

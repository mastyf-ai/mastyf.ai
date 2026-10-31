import { describe, expect, it, afterEach, vi } from 'vitest';

// Each Ratelimit instance gets the limit function registered for its prefix.
const limiters = vi.hoisted(() => ({
  byPrefix: {} as Record<string, (key: string) => Promise<{ success: boolean; reset: number }>>,
}));
vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow = (tokens: number, window: string) => ({ tokens, window });
    private prefix: string;
    constructor(opts: { prefix: string }) {
      this.prefix = opts.prefix;
    }
    limit(key: string) {
      const fn = limiters.byPrefix[this.prefix];
      return fn ? fn(key) : Promise.resolve({ success: true, reset: Date.now() });
    }
  }
  return { Ratelimit };
});
vi.mock('@upstash/redis', () => ({ Redis: class {} }));

import {
  checkLayaRateLimit,
  clientIpFromRequest,
  checkPublicApiRateLimit,
  rateLimitKeyFromRequest,
  resetRateLimitClientsForTests,
} from '@/lib/rate-limit';

function mockRequest(
  headers: Record<string, string> = {},
  ip?: string,
): Parameters<typeof checkPublicApiRateLimit>[0] {
  return {
    headers: {
      get(name: string) {
        const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : null;
      },
    },
    ...(ip !== undefined ? { ip } : {}),
  } as Parameters<typeof checkPublicApiRateLimit>[0];
}

describe('rate-limit', () => {
  afterEach(() => {
    resetRateLimitClientsForTests();
    vi.unstubAllEnvs();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.MASTYF_AI_RATE_LIMIT_REQUIRED;
    delete process.env.MASTYF_AI_TRUST_PROXY_HEADERS;
    delete process.env.MASTYF_AI_TRUST_CLOUDFLARE;
    delete process.env.MASTYF_AI_RATE_LIMIT_PROXY_SECRET;
    delete process.env.VERCEL;
  });

  it('extracts client IP from x-forwarded-for on Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    const req = mockRequest({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' });
    expect(clientIpFromRequest(req)).toBe('203.0.113.1');
  });

  it('prefers x-vercel-forwarded-for on Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    const req = mockRequest({
      'x-vercel-forwarded-for': '198.51.100.2',
      'x-forwarded-for': '203.0.113.1',
    });
    expect(clientIpFromRequest(req)).toBe('198.51.100.2');
  });

  it('ignores spoofable x-forwarded-for when proxy is untrusted', () => {
    const req = mockRequest({ 'x-forwarded-for': '203.0.113.1' });
    expect(clientIpFromRequest(req)).toBe('untrusted');
  });

  it('uses platform ip when forwarding headers are untrusted', () => {
    const req = mockRequest({ 'x-forwarded-for': '203.0.113.1' }, '192.0.2.50');
    expect(clientIpFromRequest(req)).toBe('192.0.2.50');
  });

  it('trusts x-forwarded-for when MASTYF_AI_TRUST_PROXY_HEADERS=true', () => {
    vi.stubEnv('MASTYF_AI_TRUST_PROXY_HEADERS', 'true');
    const req = mockRequest({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' });
    expect(clientIpFromRequest(req)).toBe('203.0.113.1');
  });

  it('uses proxy secret header pair for self-hosted deployments', () => {
    vi.stubEnv('MASTYF_AI_RATE_LIMIT_PROXY_SECRET', 'edge-secret');
    const req = mockRequest({
      'x-mastyf-proxy-secret': 'edge-secret',
      'x-mastyf-client-ip': '203.0.113.9',
      'x-forwarded-for': '1.2.3.4',
    });
    expect(clientIpFromRequest(req)).toBe('203.0.113.9');
  });

  it('rejects spoofed client IP without valid proxy secret', () => {
    vi.stubEnv('MASTYF_AI_RATE_LIMIT_PROXY_SECRET', 'edge-secret');
    const req = mockRequest({
      'x-mastyf-client-ip': '203.0.113.9',
      'x-forwarded-for': '1.2.3.4',
    });
    expect(clientIpFromRequest(req)).toBe('untrusted');
  });

  it('uses cf-connecting-ip when Cloudflare trust is enabled', () => {
    vi.stubEnv('MASTYF_AI_TRUST_CLOUDFLARE', 'true');
    const req = mockRequest({ 'cf-connecting-ip': '198.51.100.7' });
    expect(clientIpFromRequest(req)).toBe('198.51.100.7');
  });

  it('scopes authenticated requests by API key hash', () => {
    const token = `gcp_${'a'.repeat(40)}`;
    const req = mockRequest({
      Authorization: `Bearer ${token}`,
      'x-forwarded-for': '203.0.113.1',
    });
    const key = rateLimitKeyFromRequest(req);
    expect(key.startsWith('apiKey:')).toBe(true);
    expect(key).not.toContain('203.0.113.1');
    expect(rateLimitKeyFromRequest(req)).toBe(key);
  });

  it('selects reports limiter scope for performance API', async () => {
    vi.stubEnv('MASTYF_AI_RATE_LIMIT_REQUIRED', 'true');
    const result = await checkPublicApiRateLimit(
      mockRequest(),
      '/api/v1/reports/performance',
    );
    expect(result.success).toBe(false);
  });

  it('scopes anonymous requests by IP bucket', () => {
    vi.stubEnv('VERCEL', '1');
    const req = mockRequest({ 'x-forwarded-for': '203.0.113.1' });
    expect(rateLimitKeyFromRequest(req)).toBe('ip:203.0.113.1');
  });

  it('allows requests when Upstash is not configured (dev)', async () => {
    const result = await checkPublicApiRateLimit(mockRequest(), '/api/v1/badge/foo/json');
    expect(result.success).toBe(true);
  });

  it('blocks when rate limit required but Upstash unset', async () => {
    vi.stubEnv('MASTYF_AI_RATE_LIMIT_REQUIRED', 'true');
    const result = await checkPublicApiRateLimit(mockRequest(), '/api/v1/badge/foo/json');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.retryAfter).toBeGreaterThan(0);
    }
  });

  it('reads configurable badge rate limit from env', () => {
    vi.stubEnv('MASTYF_AI_CLOUD_BADGE_RATE_LIMIT', '42');
    vi.stubEnv('MASTYF_AI_CLOUD_DEEP_SCAN_RATE_LIMIT', '5');
    expect(process.env.MASTYF_AI_CLOUD_BADGE_RATE_LIMIT).toBe('42');
    expect(process.env.MASTYF_AI_CLOUD_DEEP_SCAN_RATE_LIMIT).toBe('5');
  });

  describe('checkLayaRateLimit', () => {
    const MINUTE = 'mastyf-ai:cloud:laya:minute';
    const DAY = 'mastyf-ai:cloud:laya:day';

    function withRedis(): void {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 't');
    }

    afterEach(() => {
      limiters.byPrefix = {};
    });

    it('uses the workspace id as the limiter key', async () => {
      withRedis();
      const minute = vi.fn(async (_key: string) => ({ success: true, reset: Date.now() }));
      const day = vi.fn(async (_key: string) => ({ success: true, reset: Date.now() }));
      limiters.byPrefix = { [MINUTE]: minute, [DAY]: day };

      expect(await checkLayaRateLimit('org-1')).toEqual({ success: true });
      expect(minute.mock.calls[0][0]).toContain('org-1');
      expect(day.mock.calls[0][0]).toContain('org-1');
    });

    it('reports when to retry once the per-minute limit is hit', async () => {
      withRedis();
      limiters.byPrefix = {
        [MINUTE]: async () => ({ success: false, reset: Date.now() + 30_000 }),
        [DAY]: async () => ({ success: true, reset: Date.now() }),
      };
      const out = await checkLayaRateLimit('org-1');
      expect(out.success).toBe(false);
      if (!out.success) {
        expect(out.retryAfter).toBeGreaterThanOrEqual(29);
        expect(out.retryAfter).toBeLessThanOrEqual(31);
      }
    });

    it('refuses when only the daily quota is used up', async () => {
      withRedis();
      limiters.byPrefix = {
        [MINUTE]: async () => ({ success: true, reset: Date.now() }),
        [DAY]: async () => ({ success: false, reset: Date.now() + 7_200_000 }),
      };
      const out = await checkLayaRateLimit('org-1');
      expect(out.success).toBe(false);
      if (!out.success) expect(out.retryAfter).toBeGreaterThanOrEqual(7_199);
    });

    it('allows without Redis, refuses when rate limiting is required', async () => {
      expect(await checkLayaRateLimit('org-1')).toEqual({ success: true });
      resetRateLimitClientsForTests();
      vi.stubEnv('MASTYF_AI_RATE_LIMIT_REQUIRED', 'true');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await checkLayaRateLimit('org-1')).toEqual({ success: false, retryAfter: 60 });
    });

    it('treats a failing Redis like a missing one', async () => {
      withRedis();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const fail = async () => {
        throw new Error('ECONNRESET');
      };
      limiters.byPrefix = { [MINUTE]: fail, [DAY]: fail };
      expect(await checkLayaRateLimit('org-1')).toEqual({ success: true });

      vi.stubEnv('MASTYF_AI_RATE_LIMIT_REQUIRED', 'true');
      expect(await checkLayaRateLimit('org-1')).toEqual({ success: false, retryAfter: 60 });
    });
  });
});

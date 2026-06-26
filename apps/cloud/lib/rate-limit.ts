import { createHash } from 'crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { NextRequest } from 'next/server';
import { extractBearerToken, extractRawBearerToken } from './api-keys';

export type RateLimitResult =
  | { success: true }
  | { success: false; retryAfter: number };

let badgeLimiter: Ratelimit | null | undefined;
let deepScanLimiter: Ratelimit | null | undefined;
let reportsLimiter: Ratelimit | null | undefined;
let certificationsLimiter: Ratelimit | null | undefined;
let rateLimitUnavailableLogged = false;

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function isRateLimitRequired(): boolean {
  return process.env.MASTYF_AI_RATE_LIMIT_REQUIRED === 'true';
}

function getBadgeLimit(): number {
  const raw = process.env.MASTYF_AI_CLOUD_BADGE_RATE_LIMIT;
  const n = raw ? parseInt(raw, 10) : 100;
  return Number.isFinite(n) && n > 0 ? n : 100;
}

function getDeepScanLimit(): number {
  const raw = process.env.MASTYF_AI_CLOUD_DEEP_SCAN_RATE_LIMIT;
  const n = raw ? parseInt(raw, 10) : 10;
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function getReportsLimit(): number {
  const raw = process.env.MASTYF_AI_CLOUD_REPORTS_RATE_LIMIT;
  const n = raw ? parseInt(raw, 10) : 30;
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function getCertificationsLimit(): number {
  const raw = process.env.MASTYF_AI_CLOUD_CERTIFICATIONS_RATE_LIMIT;
  const n = raw ? parseInt(raw, 10) : 30;
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function getBadgeLimiter(): Ratelimit | null {
  if (badgeLimiter !== undefined) return badgeLimiter;
  const redis = getRedis();
  if (!redis) {
    badgeLimiter = null;
    return null;
  }
  badgeLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(getBadgeLimit(), '1 h'),
    prefix: 'mastyf-ai:cloud:badge',
  });
  return badgeLimiter;
}

function getDeepScanLimiter(): Ratelimit | null {
  if (deepScanLimiter !== undefined) return deepScanLimiter;
  const redis = getRedis();
  if (!redis) {
    deepScanLimiter = null;
    return null;
  }
  deepScanLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(getDeepScanLimit(), '1 m'),
    prefix: 'mastyf-ai:cloud:deep-scan',
  });
  return deepScanLimiter;
}

function getReportsLimiter(): Ratelimit | null {
  if (reportsLimiter !== undefined) return reportsLimiter;
  const redis = getRedis();
  if (!redis) {
    reportsLimiter = null;
    return null;
  }
  reportsLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(getReportsLimit(), '1 h'),
    prefix: 'mastyf-ai:cloud:reports',
  });
  return reportsLimiter;
}

function getCertificationsLimiter(): Ratelimit | null {
  if (certificationsLimiter !== undefined) return certificationsLimiter;
  const redis = getRedis();
  if (!redis) {
    certificationsLimiter = null;
    return null;
  }
  certificationsLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(getCertificationsLimit(), '1 h'),
    prefix: 'mastyf-ai:cloud:certifications',
  });
  return certificationsLimiter;
}

type IpTrustMode = 'proxy-secret' | 'vercel' | 'cloudflare' | 'trusted-proxy' | 'untrusted';

function ipTrustMode(): IpTrustMode {
  if (process.env.MASTYF_AI_RATE_LIMIT_PROXY_SECRET) return 'proxy-secret';
  if (process.env.MASTYF_AI_TRUST_PROXY_HEADERS === 'true') return 'trusted-proxy';
  if (process.env.MASTYF_AI_TRUST_CLOUDFLARE === 'true') return 'cloudflare';
  if (process.env.VERCEL === '1') return 'vercel';
  return 'untrusted';
}

function parseFirstForwardedIp(value: string): string | null {
  const first = value.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function requestPlatformIp(request: NextRequest): string | null {
  const ip = (request as NextRequest & { ip?: string | null }).ip;
  return ip?.trim() || null;
}

/**
 * Resolve client IP for rate limiting. Spoofable forwarding headers are ignored
 * unless the deployment opts in (Vercel, trusted reverse proxy, or proxy secret).
 */
export function clientIpFromRequest(request: NextRequest): string {
  const mode = ipTrustMode();

  if (mode === 'proxy-secret') {
    const expected = process.env.MASTYF_AI_RATE_LIMIT_PROXY_SECRET!;
    const provided = request.headers.get('x-mastyf-proxy-secret');
    const clientIp = request.headers.get('x-mastyf-client-ip')?.trim();
    if (provided && provided === expected && clientIp) {
      return clientIp;
    }
    return 'untrusted';
  }

  if (mode === 'vercel') {
    const vercelIp = request.headers.get('x-vercel-forwarded-for');
    if (vercelIp) {
      const parsed = parseFirstForwardedIp(vercelIp);
      if (parsed) return parsed;
    }
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const parsed = parseFirstForwardedIp(forwarded);
      if (parsed) return parsed;
    }
    const realIp = request.headers.get('x-real-ip')?.trim();
    if (realIp) return realIp;
    return requestPlatformIp(request) ?? 'unknown';
  }

  if (mode === 'cloudflare') {
    const cfIp = request.headers.get('cf-connecting-ip')?.trim();
    if (cfIp) return cfIp;
    return requestPlatformIp(request) ?? 'unknown';
  }

  if (mode === 'trusted-proxy') {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const parsed = parseFirstForwardedIp(forwarded);
      if (parsed) return parsed;
    }
    const realIp = request.headers.get('x-real-ip')?.trim();
    if (realIp) return realIp;
    return requestPlatformIp(request) ?? 'unknown';
  }

  // Untrusted: do not read client-supplied X-Forwarded-For / X-Real-IP.
  return requestPlatformIp(request) ?? 'untrusted';
}

function hashApiKeyForRateLimit(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

/** Rate-limit bucket: per API key / bearer when authenticated, otherwise per client IP. */
export function rateLimitKeyFromRequest(request: NextRequest): string {
  const token = extractBearerToken(request.headers.get('authorization'))
    ?? extractRawBearerToken(request.headers.get('authorization'));
  if (token) {
    return `apiKey:${hashApiKeyForRateLimit(token)}`;
  }
  return `ip:${clientIpFromRequest(request)}`;
}

function resolveRateLimitScope(pathname: string): 'deep-scan' | 'reports' | 'badge' | 'certifications' {
  if (pathname.startsWith('/api/v1/deep-scan/')) return 'deep-scan';
  if (pathname.startsWith('/api/v1/reports/')) return 'reports';
  if (pathname.startsWith('/api/v1/certifications')) return 'certifications';
  return 'badge';
}

function getLimiterForPath(pathname: string): Ratelimit | null {
  const scope = resolveRateLimitScope(pathname);
  if (scope === 'deep-scan') return getDeepScanLimiter();
  if (scope === 'reports') return getReportsLimiter();
  if (scope === 'certifications') return getCertificationsLimiter();
  return getBadgeLimiter();
}

export async function checkPublicApiRateLimit(
  request: NextRequest,
  pathname: string,
): Promise<RateLimitResult> {
  const limiter = getLimiterForPath(pathname);

  if (!limiter) {
    if (isRateLimitRequired()) {
      if (!rateLimitUnavailableLogged) {
        rateLimitUnavailableLogged = true;
        console.error(
          '[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN unset but rate limiting is required in production',
        );
      }
      return { success: false, retryAfter: 60 };
    }
    return { success: true };
  }

  const scope = resolveRateLimitScope(pathname);
  const identity = rateLimitKeyFromRequest(request);
  const { success, reset } = await limiter.limit(`${scope}:${identity}`);
  if (success) return { success: true };

  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return { success: false, retryAfter };
}

/** @internal test helper */
export function resetRateLimitClientsForTests(): void {
  badgeLimiter = undefined;
  deepScanLimiter = undefined;
  reportsLimiter = undefined;
  certificationsLimiter = undefined;
  rateLimitUnavailableLogged = false;
}

import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { checkPublicApiRateLimit } from '@/lib/rate-limit';

const RATE_LIMITED_PREFIXES = [
  '/api/v1/badge/',
  '/api/v1/deep-scan/',
  '/api/v1/reports/',
  '/api/v1/certifications',
] as const;

function isRateLimitedPath(path: string): boolean {
  return RATE_LIMITED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export default auth(async (request) => {
  const path = request.nextUrl.pathname;

  if (isRateLimitedPath(path)) {
    const result = await checkPublicApiRateLimit(request, path);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: { 'Retry-After': String(result.retryAfter) },
        },
      );
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/v1/badge/:path*',
    '/api/v1/deep-scan/:path*',
    '/api/v1/deep-scan/jobs/:path*',
    '/api/v1/reports/:path*',
    '/api/v1/certifications',
    '/api/v1/certifications/:path*',
  ],
};

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Forward the laptop dashboard API key to the BFF rewrite.
 * The key is server-env only — never sent to the browser as JS.
 */
export function middleware(request: NextRequest) {
  const key = process.env.DASHBOARD_API_KEY?.trim();
  if (!key || !request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  const headers = new Headers(request.headers);
  if (!headers.get('x-api-key') && !headers.get('authorization')) {
    headers.set('x-api-key', key);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: '/api/:path*',
};

import { NextResponse } from 'next/server';
import { SHIELD_PLATFORM_ORDER, SHIELD_VERSION, shieldPlatformAvailable } from '@/lib/billing/shield-builds';

/**
 * The current Shield version, for installed apps checking for an update. Public on purpose:
 * it names a version and nothing else, and the download itself still needs a subscription.
 */
export function GET() {
  return NextResponse.json(
    {
      version: SHIELD_VERSION,
      platforms: SHIELD_PLATFORM_ORDER.filter((p) => shieldPlatformAvailable(p)),
      downloadPage: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://www.mastyf.ai').replace(/\/$/, '')}/download`,
    },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}

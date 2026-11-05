import { NextResponse } from 'next/server';
import { safeAuth } from '@/lib/safe-auth';
import { getDb, cloudDbAvailable } from '@/lib/db';
import { hashProLicenseKey } from '@/lib/pro-license-keys';
import { entitlementActive, ISSUED_SOURCE } from '@/lib/billing/license-keys';
import { SHIELD_PLATFORMS, SHIELD_VERSION, shieldPlatformAvailable, shieldPlatformOf } from '@/lib/billing/shield-builds';
import { presignShieldDownload, shieldObjectKey } from '@/lib/billing/shield-storage';

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mastyf.ai').replace(/\/$/, '');
const CHECKOUT_URL = `${SITE_URL}/pricing`;
const DOWNLOAD_PAGE_URL = `${SITE_URL}/download`;

type Access = 'session_entitlement' | 'database_license_key' | null;

/** A signed-in subscriber, or failing that a paid-up key we issued. */
async function subscriberAccess(licenseKey: string): Promise<Access> {
  if (!cloudDbAvailable()) return null;
  const db = getDb();

  const session = await safeAuth();
  if (session?.user?.email) {
    try {
      const customer = await db.query.commercialCustomers.findFirst({
        where: (fields, { eq }) => eq(fields.email, session.user.email!),
      });
      if (customer) {
        const entitlements = await db.query.commercialEntitlements.findMany({
          where: (fields, { eq }) => eq(fields.customerId, customer.id),
        });
        if (entitlements.some((e) => e.source === ISSUED_SOURCE && entitlementActive(e))) return 'session_entitlement';
      }
    } catch (err) {
      console.warn('[download/shield] Session check error:', err);
    }
  }

  if (licenseKey) {
    try {
      const entitlement = await db.query.commercialEntitlements.findFirst({
        where: (fields, { eq }) => eq(fields.licenseKeyHash, hashProLicenseKey(licenseKey)),
      });
      if (entitlement?.source === ISSUED_SOURCE && entitlementActive(entitlement)) return 'database_license_key';
    } catch (err) {
      console.warn('[download/shield] Key hash lookup error:', err);
    }
  }
  return null;
}

/** The answer for a download request, as JSON for scripts and the page, or as a redirect for a link. */
async function answer(licenseKey: string, os: string, arch: string, asJson: boolean): Promise<NextResponse> {
  const access = await subscriberAccess(licenseKey);
  if (!access) {
    if (asJson) {
      return NextResponse.json(
        { success: false, error: 'An active subscription is required', isLicensed: false, checkoutUrl: CHECKOUT_URL },
        { status: 402 },
      );
    }
    return NextResponse.redirect(CHECKOUT_URL, 302);
  }

  const platform = shieldPlatformOf(os);
  if (!shieldPlatformAvailable(platform)) {
    if (asJson) {
      return NextResponse.json(
        { success: false, error: `Shield for ${SHIELD_PLATFORMS[platform].name} is not available yet`, platform },
        { status: 404 },
      );
    }
    return NextResponse.redirect(DOWNLOAD_PAGE_URL, 302);
  }

  const downloadUrl = presignShieldDownload(shieldObjectKey(os, arch));
  if (!downloadUrl) {
    return NextResponse.json({ success: false, error: 'Downloads are unavailable' }, { status: 503 });
  }
  if (asJson) {
    return NextResponse.json({
      success: true,
      downloadUrl,
      version: SHIELD_VERSION,
      authorizedVia: access,
      isLicensed: true,
      platform,
    });
  }
  return NextResponse.redirect(downloadUrl, 302);
}

/** A link: signed-in subscribers need nothing else. `key` still works for links made before the POST form. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const isJson =
    searchParams.get('format')?.trim() === 'json' || Boolean(request.headers.get('accept')?.includes('application/json'));
  return answer(
    searchParams.get('key')?.trim() || '',
    searchParams.get('os')?.trim() || searchParams.get('platform')?.trim() || '',
    searchParams.get('arch')?.trim() || '',
    isJson,
  );
}

/** The download page's key form: the key travels in the body, so it stays out of URLs and logs. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { licenseKey?: unknown; os?: unknown; arch?: unknown } | null;
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return answer(text(body?.licenseKey), text(body?.os), text(body?.arch), true);
}

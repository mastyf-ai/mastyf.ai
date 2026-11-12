import { NextResponse, type NextRequest } from 'next/server';
import { safeAuth } from '@/lib/safe-auth';
import { getDb, cloudDbAvailable } from '@/lib/db';
import { hashProLicenseKey } from '@/lib/pro-license-keys';
import { entitlementActive, ISSUED_SOURCES } from '@/lib/billing/license-keys';
import { normalizeEmail, verifySeatCode } from '@/lib/billing/workspace-seats';
import { checkTeamJoinRateLimit } from '@/lib/rate-limit';
import {
  SHIELD_PLATFORMS,
  SHIELD_VERSION,
  shieldBuildFor,
  shieldPlatformAvailable,
  shieldPlatformOf,
} from '@/lib/billing/shield-builds';
import { presignShieldDownload, shieldObjectKey } from '@/lib/billing/shield-storage';

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mastyf.ai').replace(/\/$/, '');
const CHECKOUT_URL = `${SITE_URL}/pricing`;
const DOWNLOAD_PAGE_URL = `${SITE_URL}/download`;

type Access = 'session_entitlement' | 'database_license_key' | 'team_invite' | null;
type Invite = { email: string; code: string } | null;

/** A signed-in subscriber, a paid-up key we issued, or someone a Team lead has invited. */
async function subscriberAccess(licenseKey: string, invite: Invite): Promise<Access> {
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
        if (entitlements.some((e) => ISSUED_SOURCES.includes(e.source) && entitlementActive(e))) return 'session_entitlement';
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
      if (entitlement && ISSUED_SOURCES.includes(entitlement.source) && entitlementActive(entitlement)) {
        return 'database_license_key';
      }
    } catch (err) {
      console.warn('[download/shield] Key hash lookup error:', err);
    }
  }

  if (invite) {
    try {
      if (await verifySeatCode(normalizeEmail(invite.email), invite.code)) return 'team_invite';
    } catch {
      console.warn('[download/shield] Invitation check failed');
    }
  }
  return null;
}

/** The answer for a download request, as JSON for scripts and the page, or as a redirect for a link. */
async function answer(
  licenseKey: string,
  os: string,
  arch: string,
  asJson: boolean,
  invite: Invite = null,
  forUpdate = false,
): Promise<NextResponse> {
  const access = await subscriberAccess(licenseKey, invite);
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

  // An installed app updating itself gets the listed version's file and its checksum, and checks the
  // file before running it. No checksum listed means no update link.
  const checksum = forUpdate ? shieldBuildFor(platform, arch).sha256 : undefined;
  if (forUpdate && !checksum) {
    return NextResponse.json(
      { success: false, error: `No checked build of Shield ${SHIELD_VERSION} for ${SHIELD_PLATFORMS[platform].name} yet`, platform },
      { status: 404 },
    );
  }

  const downloadUrl = presignShieldDownload(shieldObjectKey(os, arch, forUpdate ? SHIELD_VERSION : undefined));
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
      ...(checksum ? { sha256: checksum } : {}),
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

/** The download forms: a key or a team invitation travels in the body, so it stays out of URLs and logs. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    licenseKey?: unknown;
    os?: unknown;
    arch?: unknown;
    email?: unknown;
    code?: unknown;
    forUpdate?: unknown;
  } | null;
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const invite = text(body?.email) && text(body?.code) ? { email: text(body?.email), code: text(body?.code) } : null;
  if (invite) {
    const limit = await checkTeamJoinRateLimit(request as NextRequest);
    if (!limit.success) return NextResponse.json({ success: false, error: 'Too many tries. Wait a few minutes.' }, { status: 429 });
  }
  return answer(text(body?.licenseKey), text(body?.os), text(body?.arch), true, invite, body?.forUpdate === true);
}

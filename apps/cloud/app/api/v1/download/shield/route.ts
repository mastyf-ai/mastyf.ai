import { NextResponse } from 'next/server';
import { safeAuth } from '@/lib/safe-auth';
import { getDb, cloudDbAvailable } from '@/lib/db';
import { commercialEntitlements, commercialCustomers } from '@/lib/db/schema';
import { hashProLicenseKey } from '@/lib/pro-license-keys';
import { entitlementActive } from '@/lib/billing/license-keys';
import { presignShieldDownload, shieldObjectKey } from '@/lib/billing/shield-storage';

const CHECKOUT_URL = `${(process.env.NEXT_PUBLIC_APP_URL || 'https://www.mastyf.ai').replace(/\/$/, '')}/pricing`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const licenseKey = searchParams.get('key')?.trim() || '';
  const os = searchParams.get('os')?.trim() || searchParams.get('platform')?.trim() || '';
  const arch = searchParams.get('arch')?.trim() || '';
  const format = searchParams.get('format')?.trim() || '';
  const isJson = format === 'json' || request.headers.get('accept')?.includes('application/json');

  let isAuthorized = false;
  let authReason = '';

  // 1. Check if authenticated user session has an active entitlement
  const session = await safeAuth();
  if (session?.user?.email && cloudDbAvailable()) {
    try {
      const db = getDb();
      const customer = await db.query.commercialCustomers.findFirst({
        where: (fields, { eq }) => eq(fields.email, session.user.email!),
      });

      if (customer) {
        const entitlements = await db.query.commercialEntitlements.findMany({
          where: (fields, { eq }) => eq(fields.customerId, customer.id),
        });

        if (entitlements.some((e) => entitlementActive(e))) {
          isAuthorized = true;
          authReason = 'session_entitlement';
        }
      }
    } catch (err) {
      console.warn('[download/shield] Session check error:', err);
    }
  }

  // 2. Check license key query param if not authorized by session
  if (!isAuthorized && licenseKey) {
    if (cloudDbAvailable()) {
      try {
        const db = getDb();
        const keyHash = hashProLicenseKey(licenseKey);
        const entitlement = await db.query.commercialEntitlements.findFirst({
          where: (fields, { eq }) => eq(fields.licenseKeyHash, keyHash),
        });
        if (entitlement && entitlementActive(entitlement)) {
          isAuthorized = true;
          authReason = 'database_license_key';
        }
      } catch (err) {
        console.warn('[download/shield] Key hash lookup error:', err);
      }
    }
  }

  if (!isAuthorized) {
    if (isJson) {
      return NextResponse.json(
        { success: false, error: 'An active subscription is required', isLicensed: false, checkoutUrl: CHECKOUT_URL },
        { status: 402 },
      );
    }
    return NextResponse.redirect(CHECKOUT_URL, 302);
  }

  const downloadUrl = presignShieldDownload(shieldObjectKey(os, arch));
  if (!downloadUrl) {
    return NextResponse.json({ success: false, error: 'Downloads are unavailable' }, { status: 503 });
  }

  if (isJson) {
    return NextResponse.json({
      success: true,
      downloadUrl,
      version: process.env.NEXT_PUBLIC_SHIELD_VERSION || null,
      checksum: process.env.NEXT_PUBLIC_SHIELD_DMG_SHA256 || null,
      authorizedVia: authReason,
      isLicensed: true,
      platform: os || 'mac',
    });
  }

  return NextResponse.redirect(downloadUrl, 302);
}

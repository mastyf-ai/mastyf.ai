import { NextResponse } from 'next/server';
import { safeAuth } from '@/lib/safe-auth';
import { validateLemonLicense, activateLemonLicense } from '@/lib/lemon-license-client';
import { getDb, cloudDbAvailable } from '@/lib/db';
import { commercialEntitlements, commercialCustomers } from '@/lib/db/schema';
import { hashProLicenseKey } from '@/lib/pro-license-keys';

const BASE_STORAGE_URL =
  process.env.SHIELD_STORAGE_DOWNLOAD_URL?.replace(/\/$/, '') ||
  'https://github.com/mastyf-ai/mastyf.ai/releases/latest/download';

const DEFAULT_SHIELD_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_SHIELD_DMG_URL ||
  `${BASE_STORAGE_URL}/Mastyf-Shield-latest-arm64.dmg`;

const CHECKOUT_URL =
  'https://mastyfai.lemonsqueezy.com/checkout/buy/49323daa-90ef-4157-90b9-8706acd13fe6';

function resolveReleaseUrl(os?: string, arch?: string): string {
  const normOs = (os || '').toLowerCase();
  const normArch = (arch || '').toLowerCase();

  if (normOs === 'win' || normOs === 'windows') {
    if (normArch === 'zip') return `${BASE_STORAGE_URL}/Mastyf-Shield-win-x64.zip`;
    return `${BASE_STORAGE_URL}/Mastyf-Shield-Setup-latest.exe`;
  }
  if (normOs === 'linux') {
    if (normArch === 'deb') return `${BASE_STORAGE_URL}/Mastyf-Shield-latest.deb`;
    return `${BASE_STORAGE_URL}/Mastyf-Shield-latest.AppImage`;
  }
  // macOS default
  if (normArch === 'x64' || normArch === 'intel') {
    return `${BASE_STORAGE_URL}/Mastyf-Shield-latest-x64.dmg`;
  }
  return `${BASE_STORAGE_URL}/Mastyf-Shield-latest-arm64.dmg`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const licenseKey = searchParams.get('key')?.trim() || '';
  const os = searchParams.get('os')?.trim() || searchParams.get('platform')?.trim() || '';
  const arch = searchParams.get('arch')?.trim() || '';
  const format = searchParams.get('format')?.trim() || '';
  const isJson = format === 'json' || request.headers.get('accept')?.includes('application/json');

  const targetReleaseUrl = resolveReleaseUrl(os, arch);

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
        const entitlement = await db.query.commercialEntitlements.findFirst({
          where: (fields, { eq, and }) =>
            and(eq(fields.customerId, customer.id), eq(fields.status, 'active')),
        });

        if (entitlement) {
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
        if (entitlement && entitlement.status === 'active') {
          isAuthorized = true;
          authReason = 'database_license_key';
        }
      } catch (err) {
        console.warn('[download/shield] Key hash lookup error:', err);
      }
    }

    if (!isAuthorized) {
      const valRes = await validateLemonLicense({ licenseKey });
      if (valRes.valid) {
        isAuthorized = true;
        authReason = 'lemon_validate';
      } else {
        const actRes = await activateLemonLicense({
          licenseKey,
          instanceName: 'mastyf-direct-download-instance',
        });
        if (actRes.valid) {
          isAuthorized = true;
          authReason = 'lemon_activate';
        }
      }
    }
  }

  // Under Approach A: The binary is freely downloadable, and the app enforces activation on first boot
  if (isJson) {
    return NextResponse.json({
      success: true,
      downloadUrl: targetReleaseUrl,
      version: process.env.NEXT_PUBLIC_SHIELD_VERSION || '0.2.2',
      checksum: process.env.NEXT_PUBLIC_SHIELD_DMG_SHA256 || null,
      authorizedVia: isAuthorized ? authReason : 'public_desktop_binary',
      isLicensed: isAuthorized,
      platform: os || 'mac',
      checkoutUrl: CHECKOUT_URL,
    });
  }

  return NextResponse.redirect(targetReleaseUrl, 302);
}

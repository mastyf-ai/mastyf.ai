import { NextResponse } from 'next/server';
import { getDb, cloudDbAvailable } from '@/lib/db';
import { hashProLicenseKey } from '@/lib/pro-license-keys';
import { entitlementActive, ISSUED_SOURCES } from '@/lib/billing/license-keys';

export async function POST(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
  }

  const licenseKey = typeof body.licenseKey === 'string' ? body.licenseKey.trim() : '';
  if (!licenseKey) {
    return NextResponse.json({ error: 'licenseKey is required' }, { status: 400 });
  }

  if (!cloudDbAvailable()) {
    return NextResponse.json({ valid: false, status: 'unavailable', message: 'Please try again shortly.' }, { status: 503 });
  }

  try {
    const entitlement = await getDb().query.commercialEntitlements.findFirst({
      where: (fields, { eq }) => eq(fields.licenseKeyHash, hashProLicenseKey(licenseKey)),
    });
    if (entitlement && ISSUED_SOURCES.includes(entitlement.source) && entitlementActive(entitlement)) {
      return NextResponse.json({
        valid: true,
        status: 'active',
        message: 'License key is active',
        plan: 'Mastyf Developer Pro',
        source: 'local_db',
      });
    }
  } catch (err) {
    console.warn('[license/verify] lookup failed:', err);
    return NextResponse.json({ valid: false, status: 'unavailable', message: 'Please try again shortly.' }, { status: 503 });
  }

  return NextResponse.json(
    { valid: false, status: 'invalid', message: 'Invalid or expired license key' },
    { status: 403 },
  );
}

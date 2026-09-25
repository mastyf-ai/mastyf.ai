import { NextResponse } from 'next/server';
import { validateLemonLicense, activateLemonLicense } from '@/lib/lemon-license-client';
import { getDb, cloudDbAvailable } from '@/lib/db';
import { commercialEntitlements } from '@/lib/db/schema';
import { hashProLicenseKey } from '@/lib/pro-license-keys';

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

  // 1. Check local database projection first if available
  if (cloudDbAvailable()) {
    try {
      const db = getDb();
      const keyHash = hashProLicenseKey(licenseKey);
      const entitlement = await db.query.commercialEntitlements.findFirst({
        where: (fields, { eq }) => eq(fields.licenseKeyHash, keyHash),
      });

      if (entitlement && entitlement.status === 'active') {
        return NextResponse.json({
          valid: true,
          status: 'active',
          message: 'License key is active in database',
          plan: 'Mastyf Developer Pro',
          source: 'local_db',
        });
      }
    } catch (dbErr) {
      console.warn('[license/verify] Local db lookup failed, falling back to Lemon API:', dbErr);
    }
  }

  // 2. Validate against Lemon Squeezy License API
  const res = await validateLemonLicense({ licenseKey });
  if (res.valid) {
    return NextResponse.json({
      valid: true,
      status: res.status,
      message: res.message,
      plan: 'Mastyf Developer Pro',
      instancesCount: res.instancesCount,
    });
  }

  // 3. If validate returned false because it was never activated yet, try activate check
  const actRes = await activateLemonLicense({
    licenseKey,
    instanceName: 'mastyf-web-download-verifier',
  });

  if (actRes.valid) {
    return NextResponse.json({
      valid: true,
      status: actRes.status,
      message: 'License key verified and activated',
      plan: 'Mastyf Developer Pro',
      expiresAt: actRes.expiresAt,
    });
  }

  return NextResponse.json(
    {
      valid: false,
      status: actRes.status || 'invalid',
      message: actRes.message || 'Invalid or expired license key',
    },
    { status: 403 },
  );
}

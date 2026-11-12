import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { signEntitlement } from '@/lib/ed25519-signer';
import {
  deviceDecision,
  DEVICE_LIMIT_MESSAGE,
  DEVICE_NOT_ACTIVATED_MESSAGE,
  entitlementActive,
  findIssuedEntitlement,
} from '@/lib/billing/license-keys';

const FROZEN_MODEL_REPO = 'Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened';
const FROZEN_MODEL_REVISION = 'd59a6aa01f9139dff106146addb04109afa69c03';
const GATEWAY_VERSION = '0.1.1';

function renewedEntitlement(expiresDate: Date, instanceId: string | undefined) {
  const graceDate = new Date(expiresDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const signedToken = signEntitlement({
    schema: 1,
    product: 'mastyf-guard-pro',
    license_id: 'lic_renewed',
    instance_id: instanceId || 'inst_default',
    activation_id: `act_${randomUUID().replace(/-/g, '')}`,
    model_repo: FROZEN_MODEL_REPO,
    model_revision: FROZEN_MODEL_REVISION,
    gateway_version: GATEWAY_VERSION,
    issued_at: new Date().toISOString(),
    expires_at: expiresDate.toISOString(),
    grace_until: graceDate.toISOString(),
  });

  return NextResponse.json({
    success: true,
    message: 'Entitlement token renewed successfully',
    entitlement: signedToken,
    instanceId,
  });
}

/**
 * POST /api/v1/license/renew
 * Refreshes an active commercial entitlement token for legitimate subscribers
 * whose local token is approaching expiry or within the grace window.
 */
export async function POST(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
  }

  const licenseKey = typeof body.licenseKey === 'string' ? body.licenseKey.trim() : '';
  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : undefined;

  if (!licenseKey) {
    return NextResponse.json({ error: 'licenseKey is required' }, { status: 400 });
  }

  // Keys issued for Razorpay payments: the token runs to the end of the paid period, no further.
  const issued = await findIssuedEntitlement(licenseKey);
  if (issued) {
    if (!entitlementActive(issued) || !issued.expiresAt) {
      return NextResponse.json(
        {
          success: false,
          error: 'This license key is no longer paid up. Renew your plan from the Mastyf dashboard.',
          status: 'expired',
        },
        { status: 403 },
      );
    }
    // Renewing never ties a key to a device; that only happens at activation.
    const device = deviceDecision(issued, instanceId ?? '', request.headers.get('x-mastyf-device-secret')?.trim() || undefined);
    if (device === 'refuse') {
      return NextResponse.json({ success: false, error: DEVICE_LIMIT_MESSAGE, status: 'device_limit' }, { status: 403 });
    }
    if (device === 'claim') {
      return NextResponse.json({ success: false, error: DEVICE_NOT_ACTIVATED_MESSAGE, status: 'not_activated' }, { status: 403 });
    }
    return renewedEntitlement(issued.expiresAt, instanceId);
  }

  return NextResponse.json(
    { success: false, error: 'This license key was not accepted.', status: 'inactive' },
    { status: 403 },
  );
}

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { validateLemonLicense } from '@/lib/lemon-license-client';
import { signEntitlement } from '@/lib/ed25519-signer';
import { getDb, cloudDbAvailable } from '@/lib/db';
import { commercialEntitlements, commercialSubscriptions } from '@/lib/db/schema';
import { hashProLicenseKey } from '@/lib/pro-license-keys';
import { isSubscriptionEntitled } from '@/lib/lemonsqueezy-webhook';

const FROZEN_MODEL_REPO = 'Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened';
const FROZEN_MODEL_REVISION = 'd59a6aa01f9139dff106146addb04109afa69c03';
const GATEWAY_VERSION = '0.1.1';

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

  // 1. Authoritative Instance Validation with Lemon Squeezy
  const validation = await validateLemonLicense({
    licenseKey,
    instanceId,
  });

  if (!validation.valid) {
    const statusCode = validation.status === 'rate_limited' ? 429 : 403;
    return NextResponse.json(
      {
        success: false,
        error: validation.message,
        status: validation.status,
      },
      { status: statusCode },
    );
  }

  // 2. Check Local Subscription Projection Lifecycle
  let currentPeriodEnd: Date | undefined;
  let endsAt: Date | undefined;

  if (cloudDbAvailable()) {
    const db = getDb();
    const keyHash = hashProLicenseKey(licenseKey);
    const entitlement = await db.query.commercialEntitlements.findFirst({
      where: eq(commercialEntitlements.licenseKeyHash, keyHash),
    });

    if (entitlement?.subscriptionId) {
      const sub = await db.query.commercialSubscriptions.findFirst({
        where: eq(commercialSubscriptions.id, entitlement.subscriptionId),
      });

      if (sub) {
        if (sub.status === 'expired') {
          return NextResponse.json(
            {
              success: false,
              error: 'Subscription has expired. Renewal not permitted.',
              status: 'expired',
            },
            { status: 403 },
          );
        }

        currentPeriodEnd = sub.currentPeriodEnd ?? undefined;
        endsAt = sub.endsAt ?? undefined;

        const isEntitled = isSubscriptionEntitled({
          status: sub.status,
          currentPeriodEnd,
          endsAt,
        });

        if (!isEntitled) {
          return NextResponse.json(
            {
              success: false,
              error: `Subscription status '${sub.status}' is not eligible for renewal`,
              status: sub.status,
            },
            { status: 403 },
          );
        }
      }
    }
  }

  // 3. Mint Extended Signed Entitlement Token
  const now = new Date();
  const issuedAt = now.toISOString();

  // Extend 30 days from current period end or now
  const baseDate = currentPeriodEnd && currentPeriodEnd.getTime() > now.getTime() ? currentPeriodEnd : now;
  const expiresDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const graceDate = new Date(expiresDate.getTime() + 7 * 24 * 60 * 60 * 1000);

  const activationId = `act_${randomUUID().replace(/-/g, '')}`;
  const signedToken = signEntitlement({
    schema: 1,
    product: 'mastyf-guard-pro',
    license_id: 'lic_renewed',
    instance_id: instanceId || validation.instanceId || 'inst_default',
    activation_id: activationId,
    model_repo: FROZEN_MODEL_REPO,
    model_revision: FROZEN_MODEL_REVISION,
    gateway_version: GATEWAY_VERSION,
    issued_at: issuedAt,
    expires_at: expiresDate.toISOString(),
    grace_until: graceDate.toISOString(),
  });

  return NextResponse.json({
    success: true,
    message: 'Entitlement token renewed successfully',
    entitlement: signedToken,
    instanceId: instanceId || validation.instanceId,
  });
}

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { activateLemonLicense } from '@/lib/lemon-license-client';
import { bindAndGrantHFAccess } from '@/lib/hf-binding-service';
import { signEntitlement } from '@/lib/ed25519-signer';
import { getDb, cloudDbAvailable } from '@/lib/db';
import { commercialEntitlements, commercialCustomers } from '@/lib/db/schema';
import { hashProLicenseKey } from '@/lib/pro-license-keys';

const FROZEN_MODEL_REPO = 'Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened';
const FROZEN_MODEL_REVISION = 'd59a6aa01f9139dff106146addb04109afa69c03';
const GATEWAY_VERSION = '0.1.1';

export async function POST(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
  }

  const licenseKey = typeof body.licenseKey === 'string' ? body.licenseKey.trim() : '';
  const hfUsername = typeof body.hfUsername === 'string' ? body.hfUsername.trim() : '';
  const instanceName = typeof body.instanceName === 'string' ? body.instanceName.trim() : 'default-gateway-instance';

  if (!licenseKey) {
    return NextResponse.json({ error: 'licenseKey is required' }, { status: 400 });
  }

  // Shield-only activations omit hfUsername. Guard model bind still requires it.

  // 1. Authoritative License Activation via Lemon Squeezy License API
  const lemonActivation = await activateLemonLicense({
    licenseKey,
    instanceName,
    expectedStoreId: process.env.LEMONSQUEEZY_STORE_ID,
    expectedProductId: process.env.LEMONSQUEEZY_PRODUCT_ID,
    expectedVariantId: process.env.LEMONSQUEEZY_VARIANT_ID,
  });

  if (!lemonActivation.valid) {
    const statusCode = lemonActivation.status === 'rate_limited' ? 429 : 403;
    return NextResponse.json(
      {
        success: false,
        error: lemonActivation.message,
        status: lemonActivation.status,
      },
      { status: statusCode },
    );
  }

  const customerEmail =
    lemonActivation.customerEmail ||
    (typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : '');

  // 2. Resolve Customer and Enforce Permanent HF Identity Binding
  if (cloudDbAvailable() && customerEmail) {
    const db = getDb();
    const keyHash = hashProLicenseKey(licenseKey);

    // Ensure entitlement row exists in local projection
    let entitlement = await db.query.commercialEntitlements.findFirst({
      where: eq(commercialEntitlements.licenseKeyHash, keyHash),
    });

    if (!entitlement) {
      let customer = await db.query.commercialCustomers.findFirst({
        where: eq(commercialCustomers.email, customerEmail),
      });
      if (!customer) {
        const custId = `cst_${randomUUID().replace(/-/g, '')}`;
        await db.insert(commercialCustomers).values({
          id: custId,
          email: customerEmail,
        });
        customer = {
          id: custId,
          email: customerEmail,
          lemonCustomerId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      const entId = `ent_${randomUUID().replace(/-/g, '')}`;
      await db.insert(commercialEntitlements).values({
        id: entId,
        customerId: customer.id,
        licenseKeyHash: keyHash,
        licenseKeyPreview: licenseKey.length >= 8 ? `MG-****-${licenseKey.slice(-4).toUpperCase()}` : 'MG-****-PRO',
        lemonLicenseId: lemonActivation.licenseKeyId,
        lemonInstanceId: lemonActivation.instanceId,
        status: 'active',
      });
    } else if (lemonActivation.instanceId && entitlement.lemonInstanceId !== lemonActivation.instanceId) {
      // Update the instance ID from Lemon Squeezy
      await db
        .update(commercialEntitlements)
        .set({
          lemonInstanceId: lemonActivation.instanceId,
          updatedAt: new Date(),
        })
        .where(eq(commercialEntitlements.id, entitlement.id));
    }
  }

  // 3. Bind Identity and Grant Hugging Face Access (Guard installs only)
  if (customerEmail && hfUsername) {
    const bindRes = await bindAndGrantHFAccess({
      customerEmail,
      licenseKey,
      hfUsername,
      repoId: FROZEN_MODEL_REPO,
    });

    if (!bindRes.success && bindRes.statusCode === 409) {
      // Hard identity conflict
      return NextResponse.json(
        {
          success: false,
          error: bindRes.message,
          code: bindRes.code,
        },
        { status: 409 },
      );
    }
  }

  // 4. Issue Asymmetric Ed25519 Signed Entitlement Token (Zero PII)
  const now = new Date();
  const issuedAt = now.toISOString();

  let expiresDate: Date;
  if (lemonActivation.expiresAt) {
    expiresDate = new Date(lemonActivation.expiresAt);
  } else {
    // Default 30-day period if not explicit on license
    expiresDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  // 7-day grace period
  const graceDate = new Date(expiresDate.getTime() + 7 * 24 * 60 * 60 * 1000);

  const activationId = `act_${randomUUID().replace(/-/g, '')}`;
  const signedToken = signEntitlement({
    schema: 1,
    product: 'mastyf-guard-pro',
    license_id: lemonActivation.licenseKeyId || 'lic_active',
    instance_id: lemonActivation.instanceId || 'inst_default',
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
    message: 'Mastyf Guard Pro license successfully activated',
    entitlement: signedToken,
    instanceId: lemonActivation.instanceId,
  });
}

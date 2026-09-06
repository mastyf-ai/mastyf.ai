import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb, cloudDbAvailable } from './db';
import {
  commercialCustomers,
  commercialSubscriptions,
  commercialEntitlements,
  hfEntitlements,
} from './db/schema';
import { hashProLicenseKey } from './pro-license-keys';
import { isSubscriptionEntitled } from './lemonsqueezy-webhook';
import { grantHFAccess, HFGrantResult } from './hf-gating';

export type BindAndGrantResult = {
  success: boolean;
  code:
    | 'GRANTED'
    | 'ALREADY_GRANTED'
    | 'INVALID_LICENSE'
    | 'CUSTOMER_MISMATCH'
    | 'SUBSCRIPTION_EXPIRED'
    | 'SUBSCRIPTION_NOT_ENTITLED'
    | 'IDENTITY_CONFLICT'
    | 'INVALID_HF_USER'
    | 'PERMISSION_DENIED'
    | 'RATE_LIMITED'
    | 'SYNC_ERROR';
  statusCode: number;
  message: string;
  hfUsername?: string;
  entitlementId?: string;
  retryable?: boolean;
};

const DEFAULT_REPO = 'Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened';

/**
 * Permanently binds customer license to a Hugging Face username and triggers gated model access grant.
 * 
 * Invariants:
 * 1. License must exist and be owned by customer.
 * 2. Subscription must be actively entitled (active, on_trial, or cancelled-but-paid).
 * 3. Expired subscriptions are strictly blocked from receiving new model grants.
 * 4. Once bound, changing the HF username on a license is rejected with 409 Conflict.
 * 5. Binding an HF username already claimed by another customer is rejected with 409 Conflict.
 * 6. Hugging Face API call is decoupled from billing transactions.
 */
export async function bindAndGrantHFAccess(opts: {
  customerEmail: string;
  licenseKey: string;
  hfUsername: string;
  repoId?: string;
  fetchFn?: typeof fetch;
}): Promise<BindAndGrantResult> {
  const repoId = opts.repoId || DEFAULT_REPO;
  const hfUsername = opts.hfUsername.trim();
  const customerEmail = opts.customerEmail.trim().toLowerCase();

  if (!hfUsername) {
    return {
      success: false,
      code: 'INVALID_HF_USER',
      statusCode: 400,
      message: 'Hugging Face username is required',
    };
  }

  if (!cloudDbAvailable()) {
    // In-memory / mock mode for non-DB unit tests
    const hfRes = await grantHFAccess({
      hfUsername,
      repoId,
      fetchFn: opts.fetchFn,
    });
    return {
      success: hfRes.success,
      code: hfRes.success ? 'GRANTED' : (hfRes.status.toUpperCase() as any),
      statusCode: hfRes.success ? 200 : (hfRes.statusCode || 500),
      message: hfRes.message,
      hfUsername,
      retryable: hfRes.retryable,
    };
  }

  const db = getDb();
  const keyHash = hashProLicenseKey(opts.licenseKey.trim());

  // 1. Validate Entitlement and Customer
  const entitlement = await db.query.commercialEntitlements.findFirst({
    where: eq(commercialEntitlements.licenseKeyHash, keyHash),
  });

  if (!entitlement) {
    return {
      success: false,
      code: 'INVALID_LICENSE',
      statusCode: 404,
      message: 'Commercial license key not found',
    };
  }

  const customer = await db.query.commercialCustomers.findFirst({
    where: eq(commercialCustomers.id, entitlement.customerId),
  });

  if (!customer || customer.email.toLowerCase() !== customerEmail) {
    return {
      success: false,
      code: 'CUSTOMER_MISMATCH',
      statusCode: 403,
      message: 'License key does not belong to the specified customer email',
    };
  }

  // 2. Validate Commercial Subscription Lifecycle
  if (entitlement.subscriptionId) {
    const sub = await db.query.commercialSubscriptions.findFirst({
      where: eq(commercialSubscriptions.id, entitlement.subscriptionId),
    });

    if (sub) {
      if (sub.status === 'expired') {
        return {
          success: false,
          code: 'SUBSCRIPTION_EXPIRED',
          statusCode: 403,
          message: 'Cannot grant model access: subscription is expired. Please renew your subscription.',
        };
      }

      const isEntitled = isSubscriptionEntitled({
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        endsAt: sub.endsAt,
      });

      if (!isEntitled) {
        return {
          success: false,
          code: 'SUBSCRIPTION_NOT_ENTITLED',
          statusCode: 403,
          message: `Subscription status '${sub.status}' is not eligible for model access`,
        };
      }
    }
  }

  // 3. Permanent Identity Binding Checks
  // A. Check if customer already has a bound HF username
  const existingCustGrant = await db.query.hfEntitlements.findFirst({
    where: eq(hfEntitlements.customerId, customer.id),
  });

  if (existingCustGrant) {
    if (existingCustGrant.hfUsername.toLowerCase() !== hfUsername.toLowerCase()) {
      return {
        success: false,
        code: 'IDENTITY_CONFLICT',
        statusCode: 409,
        message: `License is already permanently bound to Hugging Face account '@${existingCustGrant.hfUsername}'. Re-binding to a different account is prohibited.`,
      };
    }
  }

  // B. Check if this HF username is already bound to a DIFFERENT customer
  const existingUserGrant = await db.query.hfEntitlements.findFirst({
    where: eq(hfEntitlements.hfUsername, hfUsername),
  });

  if (existingUserGrant && existingUserGrant.customerId !== customer.id) {
    return {
      success: false,
      code: 'IDENTITY_CONFLICT',
      statusCode: 409,
      message: `Hugging Face username '@${hfUsername}' is already bound to another customer license.`,
    };
  }

  // 4. Execute Decoupled Hugging Face Hub Access Grant
  const hfRes: HFGrantResult = await grantHFAccess({
    hfUsername,
    repoId,
    fetchFn: opts.fetchFn,
  });

  // 5. Persist / Update Identity Binding State
  const now = new Date();
  if (existingCustGrant) {
    await db
      .update(hfEntitlements)
      .set({
        status: hfRes.status,
        lastSyncedAt: hfRes.success ? now : existingCustGrant.lastSyncedAt,
        errorMessage: hfRes.success ? null : hfRes.message,
        updatedAt: now,
      })
      .where(eq(hfEntitlements.id, existingCustGrant.id));
  } else {
    const grantId = `hfe_${randomUUID().replace(/-/g, '')}`;
    await db.insert(hfEntitlements).values({
      id: grantId,
      customerId: customer.id,
      hfUsername,
      repoId,
      status: hfRes.status,
      lastSyncedAt: hfRes.success ? now : null,
      errorMessage: hfRes.success ? null : hfRes.message,
      isPermanentlyBound: true,
    });
  }

  const responseCode = hfRes.success
    ? (hfRes.message.includes('already') ? 'ALREADY_GRANTED' : 'GRANTED')
    : (hfRes.status.toUpperCase() as any);

  return {
    success: hfRes.success,
    code: responseCode,
    statusCode: hfRes.success ? 200 : (hfRes.statusCode || 500),
    message: hfRes.message,
    hfUsername,
    entitlementId: entitlement.id,
    retryable: hfRes.retryable,
  };
}

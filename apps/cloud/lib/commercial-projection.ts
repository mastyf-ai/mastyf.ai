import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb, cloudDbAvailable } from './db';
import {
  commercialCustomers,
  commercialSubscriptions,
  commercialEntitlements,
  webhookEventLogs,
} from './db/schema';
import {
  ParsedSubscription,
  ParsedLicenseKey,
  isTransitionAllowed,
  isSubscriptionEntitled,
} from './lemonsqueezy-webhook';
import { hashProLicenseKey } from './pro-license-keys';

export type WebhookRecordResult = {
  isNew: boolean;
  eventId: string;
};

/**
 * Ensures webhook idempotency by recording the event in webhook_event_logs.
 * Returns isNew=false if the event was already processed.
 */
export async function recordWebhookEvent(opts: {
  eventId: string;
  eventName: string;
  payloadHash: string;
  eventTimestamp?: Date;
}): Promise<WebhookRecordResult> {
  if (!cloudDbAvailable()) {
    // In test or non-DB environment, treat as new
    return { isNew: true, eventId: opts.eventId };
  }

  const db = getDb();
  const existing = await db.query.webhookEventLogs.findFirst({
    where: eq(webhookEventLogs.id, opts.eventId),
  });

  if (existing) {
    return { isNew: false, eventId: opts.eventId };
  }

  try {
    await db.insert(webhookEventLogs).values({
      id: opts.eventId,
      eventName: opts.eventName,
      eventTimestamp: opts.eventTimestamp,
      payloadHash: opts.payloadHash,
      status: 'processed',
    });
    return { isNew: true, eventId: opts.eventId };
  } catch (err: unknown) {
    // Handle potential concurrent race condition on primary key
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return { isNew: false, eventId: opts.eventId };
    }
    throw err;
  }
}

/**
 * Projects Lemon Squeezy subscription state transactionally into PostgreSQL.
 * Enforces monotonic state transitions and out-of-order protection.
 */
export async function projectSubscription(
  sub: ParsedSubscription,
): Promise<{
  customerId: string;
  subscriptionId: string;
  action: 'created' | 'updated' | 'ignored_out_of_order';
  reason?: string;
}> {
  if (!cloudDbAvailable()) {
    return {
      customerId: 'mock_cust',
      subscriptionId: 'mock_sub',
      action: 'created',
    };
  }

  const db = getDb();

  return await db.transaction(async (tx) => {
    // 1. Upsert Customer
    let customer = await tx.query.commercialCustomers.findFirst({
      where: eq(commercialCustomers.email, sub.userEmail),
    });

    if (!customer) {
      const newCustId = `cst_${randomUUID().replace(/-/g, '')}`;
      await tx.insert(commercialCustomers).values({
        id: newCustId,
        email: sub.userEmail,
        lemonCustomerId: sub.lemonCustomerId,
      });
      customer = {
        id: newCustId,
        email: sub.userEmail,
        lemonCustomerId: sub.lemonCustomerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else if (sub.lemonCustomerId && customer.lemonCustomerId !== sub.lemonCustomerId) {
      await tx
        .update(commercialCustomers)
        .set({ lemonCustomerId: sub.lemonCustomerId, updatedAt: new Date() })
        .where(eq(commercialCustomers.id, customer.id));
    }

    // 2. Query Existing Subscription Projection
    const existingSub = await tx.query.commercialSubscriptions.findFirst({
      where: eq(commercialSubscriptions.lemonSubscriptionId, sub.lemonSubscriptionId),
    });

    if (existingSub) {
      // Enforce Monotonicity & Out-of-Order Protection
      const transitionCheck = isTransitionAllowed({
        existingStatus: existingSub.status,
        incomingStatus: sub.status,
        existingLemonUpdatedAt: existingSub.lemonUpdatedAt,
        incomingLemonUpdatedAt: sub.lemonUpdatedAt,
        existingPeriodEnd: existingSub.currentPeriodEnd,
        incomingPeriodEnd: sub.currentPeriodEnd,
      });

      if (!transitionCheck.allowed) {
        return {
          customerId: customer.id,
          subscriptionId: existingSub.id,
          action: 'ignored_out_of_order',
          reason: transitionCheck.reason,
        };
      }

      // Valid monotonic update
      await tx
        .update(commercialSubscriptions)
        .set({
          status: sub.status,
          productId: sub.productId ?? existingSub.productId,
          variantId: sub.variantId ?? existingSub.variantId,
          currentPeriodStart: sub.currentPeriodStart ?? existingSub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd ?? existingSub.currentPeriodEnd,
          endsAt: sub.endsAt ?? existingSub.endsAt,
          cancelledAt: sub.cancelledAt ?? existingSub.cancelledAt,
          lemonUpdatedAt: sub.lemonUpdatedAt,
          updatedAt: new Date(),
        })
        .where(eq(commercialSubscriptions.id, existingSub.id));

      // Update linked commercial entitlement status if exists
      const isEntitled = isSubscriptionEntitled({
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd ?? existingSub.currentPeriodEnd,
        endsAt: sub.endsAt ?? existingSub.endsAt,
      });

      const entitlementStatus = isEntitled
        ? 'active'
        : sub.status === 'past_due'
        ? 'grace_period'
        : 'expired';

      await tx
        .update(commercialEntitlements)
        .set({
          status: entitlementStatus,
          updatedAt: new Date(),
        })
        .where(eq(commercialEntitlements.subscriptionId, existingSub.id));

      return {
        customerId: customer.id,
        subscriptionId: existingSub.id,
        action: 'updated',
      };
    }

    // 3. Insert New Subscription
    const newSubId = `sub_${randomUUID().replace(/-/g, '')}`;
    await tx.insert(commercialSubscriptions).values({
      id: newSubId,
      customerId: customer.id,
      lemonSubscriptionId: sub.lemonSubscriptionId,
      status: sub.status,
      productId: sub.productId,
      variantId: sub.variantId,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      endsAt: sub.endsAt,
      cancelledAt: sub.cancelledAt,
      lemonUpdatedAt: sub.lemonUpdatedAt,
    });

    return {
      customerId: customer.id,
      subscriptionId: newSubId,
      action: 'created',
    };
  });
}

/**
 * Projects Lemon Squeezy license key into commercial entitlements.
 * Links to existing customer and subscription.
 */
export async function projectLicenseKey(
  lic: ParsedLicenseKey,
): Promise<{
  entitlementId: string;
  action: 'created' | 'updated';
}> {
  if (!cloudDbAvailable()) {
    return {
      entitlementId: 'mock_ent',
      action: 'created',
    };
  }

  const db = getDb();
  const keyHash = hashProLicenseKey(lic.key);
  const keyPreview = lic.key.length >= 8
    ? `MG-****-${lic.key.slice(-4).toUpperCase()}`
    : 'MG-****-PRO';

  return await db.transaction(async (tx) => {
    // 1. Resolve Customer
    let customerId: string | undefined;
    if (lic.email) {
      const customer = await tx.query.commercialCustomers.findFirst({
        where: eq(commercialCustomers.email, lic.email),
      });
      customerId = customer?.id;
    }

    // If customer doesn't exist yet, create placeholder customer
    if (!customerId && lic.email) {
      customerId = `cst_${randomUUID().replace(/-/g, '')}`;
      await tx.insert(commercialCustomers).values({
        id: customerId,
        email: lic.email,
      });
    }

    if (!customerId) {
      // Fallback default customer id if email is omitted
      customerId = 'cst_anonymous';
      const anonCust = await tx.query.commercialCustomers.findFirst({
        where: eq(commercialCustomers.id, customerId),
      });
      if (!anonCust) {
        await tx.insert(commercialCustomers).values({
          id: customerId,
          email: 'anonymous@mastyf.ai',
        });
      }
    }

    // 2. Resolve Linked Subscription
    let subscriptionId: string | undefined;
    if (lic.lemonSubscriptionId) {
      const sub = await tx.query.commercialSubscriptions.findFirst({
        where: eq(commercialSubscriptions.lemonSubscriptionId, lic.lemonSubscriptionId),
      });
      subscriptionId = sub?.id;
    }

    // 3. Upsert Entitlement
    const existing = await tx.query.commercialEntitlements.findFirst({
      where: eq(commercialEntitlements.licenseKeyHash, keyHash),
    });

    const status = lic.status === 'active' ? 'active' : 'expired';

    if (existing) {
      await tx
        .update(commercialEntitlements)
        .set({
          lemonLicenseId: lic.lemonLicenseId,
          subscriptionId: subscriptionId ?? existing.subscriptionId,
          status,
          activationLimit: lic.activationLimit,
          instancesCount: lic.instancesCount,
          lastValidatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(commercialEntitlements.id, existing.id));

      return { entitlementId: existing.id, action: 'updated' };
    }

    const newEntId = `ent_${randomUUID().replace(/-/g, '')}`;
    await tx.insert(commercialEntitlements).values({
      id: newEntId,
      customerId,
      subscriptionId,
      product: 'mastyf-guard-pro',
      licenseKeyHash: keyHash,
      licenseKeyPreview: keyPreview,
      lemonLicenseId: lic.lemonLicenseId,
      status,
      activationLimit: lic.activationLimit,
      instancesCount: lic.instancesCount,
      lastValidatedAt: new Date(),
    });

    return { entitlementId: newEntId, action: 'created' };
  });
}

import { createHash, createHmac, timingSafeEqual } from 'crypto';

export type LemonSqueezyWebhookPayload = {
  meta?: {
    event_name?: string;
    test_mode?: boolean;
    custom_data?: Record<string, unknown>;
  };
  data?: {
    type?: string;
    id?: string;
    attributes?: Record<string, unknown>;
    relationships?: Record<string, { data?: { type?: string; id?: string } }>;
  };
};

/**
 * Verifies the X-Signature header against the raw body using HMAC-SHA256 with timing-safe comparison.
 */
export function verifyLemonSqueezySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  try {
    const digest = Buffer.from(
      createHmac('sha256', secret).update(rawBody).digest('hex'),
      'utf8',
    );
    const signature = Buffer.from(signatureHeader, 'utf8');
    if (digest.length !== signature.length) return false;
    return timingSafeEqual(digest, signature);
  } catch {
    return false;
  }
}

/**
 * Computes SHA-256 hash of payload for deduplication and audit logging.
 */
export function hashPayload(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export function webhookEventName(
  payload: LemonSqueezyWebhookPayload,
  headerEventName: string | null,
): string {
  return (
    payload.meta?.event_name?.trim() ||
    headerEventName?.trim() ||
    ''
  ).toLowerCase();
}

export function payloadStoreId(payload: LemonSqueezyWebhookPayload): string | undefined {
  const attrs = payload.data?.attributes;
  if (!attrs) return undefined;
  const storeId = attrs.store_id ?? attrs.storeId;
  if (storeId === undefined || storeId === null) return undefined;
  return String(storeId);
}

export function matchesConfiguredStore(
  payload: LemonSqueezyWebhookPayload,
  configuredStoreId: string | undefined,
): boolean {
  if (!configuredStoreId?.trim()) return true;
  const eventStoreId = payloadStoreId(payload);
  if (!eventStoreId) return true;
  return eventStoreId === configuredStoreId.trim();
}

export type ParsedSubscription = {
  lemonSubscriptionId: string;
  lemonCustomerId: string;
  userEmail: string;
  status: string;
  productId?: string;
  variantId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  endsAt?: Date;
  cancelledAt?: Date;
  lemonUpdatedAt: Date;
  customData?: Record<string, unknown>;
};

function parseIsoDate(val: unknown): Date | undefined {
  if (typeof val === 'string' && val.trim()) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  return undefined;
}

export function parseSubscriptionEvent(
  payload: LemonSqueezyWebhookPayload,
): ParsedSubscription | null {
  if (payload.data?.type !== 'subscriptions') return null;
  const attrs = payload.data.attributes;
  if (!attrs) return null;

  const lemonSubscriptionId = payload.data.id?.trim();
  if (!lemonSubscriptionId) return null;

  const emailRaw = attrs.user_email ?? attrs.userEmail;
  const userEmail = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
  if (!userEmail) return null;

  const customerIdRaw = attrs.customer_id ?? attrs.customerId;
  const lemonCustomerId = customerIdRaw !== undefined && customerIdRaw !== null
    ? String(customerIdRaw).trim()
    : `cust_${lemonSubscriptionId}`;

  const statusRaw = attrs.status;
  const status = typeof statusRaw === 'string' ? statusRaw.trim().toLowerCase() : 'active';

  const productId = attrs.product_id ? String(attrs.product_id) : undefined;
  const variantId = attrs.variant_id ? String(attrs.variant_id) : undefined;

  const currentPeriodStart = parseIsoDate(attrs.created_at ?? attrs.createdAt);
  const currentPeriodEnd = parseIsoDate(attrs.renews_at ?? attrs.renewsAt ?? attrs.ends_at ?? attrs.endsAt);
  const endsAt = parseIsoDate(attrs.ends_at ?? attrs.endsAt);
  const cancelledAt = parseIsoDate(attrs.cancelled_at ?? attrs.cancelledAt);

  const updatedRaw = attrs.updated_at ?? attrs.updatedAt ?? attrs.created_at ?? attrs.createdAt;
  const lemonUpdatedAt = parseIsoDate(updatedRaw) ?? new Date();

  return {
    lemonSubscriptionId,
    lemonCustomerId,
    userEmail,
    status,
    productId,
    variantId,
    currentPeriodStart,
    currentPeriodEnd,
    endsAt,
    cancelledAt,
    lemonUpdatedAt,
    customData: payload.meta?.custom_data,
  };
}

export type ParsedLicenseKey = {
  key: string;
  email?: string;
  lemonLicenseId: string;
  lemonOrderId?: string;
  lemonSubscriptionId?: string;
  status: string;
  activationLimit: number;
  instancesCount: number;
  lemonUpdatedAt: Date;
};

export function parseLicenseKeyCreated(payload: LemonSqueezyWebhookPayload): ParsedLicenseKey | null {
  if (payload.data?.type !== 'license-keys') return null;
  const attrs = payload.data.attributes;
  if (!attrs) return null;

  const key = typeof attrs.key === 'string' ? attrs.key.trim() : '';
  if (!key) return null;

  const lemonLicenseId = payload.data.id?.trim();
  if (!lemonLicenseId) return null;

  const emailRaw = attrs.user_email ?? attrs.userEmail;
  const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : undefined;

  const orderId = attrs.order_id ?? attrs.orderId;
  const lemonOrderId = orderId !== undefined && orderId !== null ? String(orderId) : undefined;

  const subId = attrs.subscription_id ?? attrs.subscriptionId;
  const lemonSubscriptionId = subId !== undefined && subId !== null ? String(subId) : undefined;

  const statusRaw = attrs.status;
  const status = typeof statusRaw === 'string' ? statusRaw.trim().toLowerCase() : 'active';

  const activationLimit = typeof attrs.activation_limit === 'number' ? attrs.activation_limit : 2;
  const instancesCount = typeof attrs.instances_count === 'number' ? attrs.instances_count : 0;

  const updatedRaw = attrs.updated_at ?? attrs.updatedAt ?? attrs.created_at ?? attrs.createdAt;
  const lemonUpdatedAt = parseIsoDate(updatedRaw) ?? new Date();

  return {
    key,
    email,
    lemonLicenseId,
    lemonOrderId,
    lemonSubscriptionId,
    status,
    activationLimit,
    instancesCount,
    lemonUpdatedAt,
  };
}

export function parseOrderRefunded(payload: LemonSqueezyWebhookPayload): string | null {
  if (payload.data?.type !== 'orders') return null;
  const orderId = payload.data.id?.trim();
  if (orderId) return orderId;
  const attrs = payload.data.attributes;
  const attrId = attrs?.order_id ?? attrs?.id;
  if (attrId !== undefined && attrId !== null) return String(attrId);
  return null;
}

/**
 * Enforces Monotonic State Transitions and Out-of-Order Protection.
 * 
 * Rules:
 * 1. If an event has a timestamp strictly older than the recorded lemonUpdatedAt, it is out-of-order and rejected.
 * 2. If existing status is 'expired', it can only be resurrected by a strictly newer renewal/active event with updated dates.
 * 3. If existing status is 'cancelled', an incoming 'active' event cannot revert it unless its timestamp is strictly newer.
 */
const STATUS_PRECEDENCE: Record<string, number> = {
  expired: 5,
  cancelled: 4,
  past_due: 3,
  paused: 2,
  unpaid: 2,
  active: 1,
  on_trial: 0,
};

export function isTransitionAllowed(opts: {
  existingStatus?: string;
  incomingStatus: string;
  existingLemonUpdatedAt?: Date | null;
  incomingLemonUpdatedAt: Date;
  existingPeriodEnd?: Date | null;
  incomingPeriodEnd?: Date | null;
  existingEventId?: string | null;
  incomingEventId?: string | null;
}): { allowed: boolean; reason?: string } {
  const {
    existingStatus,
    incomingStatus,
    existingLemonUpdatedAt,
    incomingLemonUpdatedAt,
    existingPeriodEnd,
    incomingPeriodEnd,
    existingEventId,
    incomingEventId,
  } = opts;

  if (!existingStatus) {
    return { allowed: true };
  }

  // 1. Strict timestamp comparison with deterministic tie-breaker
  if (existingLemonUpdatedAt) {
    const existingMs = existingLemonUpdatedAt.getTime();
    const incomingMs = incomingLemonUpdatedAt.getTime();

    if (incomingMs < existingMs) {
      return {
        allowed: false,
        reason: `Out-of-order event rejected: incoming timestamp (${incomingLemonUpdatedAt.toISOString()}) is older than recorded state (${existingLemonUpdatedAt.toISOString()})`,
      };
    }

    // Deterministic tie-breaker for EQUAL timestamps
    if (incomingMs === existingMs) {
      const existingPrecedence = STATUS_PRECEDENCE[existingStatus.toLowerCase()] ?? 1;
      const incomingPrecedence = STATUS_PRECEDENCE[incomingStatus.toLowerCase()] ?? 1;

      // Cannot downgrade from higher precedence state (e.g. expired or cancelled) to lower (e.g. active) with identical timestamp
      if (existingPrecedence > incomingPrecedence) {
        return {
          allowed: false,
          reason: `Equal timestamp tie-breaker: cannot downgrade state from '${existingStatus}' to '${incomingStatus}' without a strictly newer timestamp`,
        };
      }

      // If equal precedence and event IDs provided, tie-break lexicographically to guarantee determinism
      if (existingPrecedence === incomingPrecedence && existingEventId && incomingEventId) {
        if (incomingEventId <= existingEventId && incomingStatus !== existingStatus) {
          return {
            allowed: false,
            reason: 'Equal timestamp tie-breaker: deterministic event ID ordering preserves existing state',
          };
        }
      }
    }
  }

  // 2. Terminal Expired state protection
  if (existingStatus === 'expired') {
    // Only allow resurrection if incoming is explicitly active with a newer period end
    if (incomingStatus === 'active') {
      if (
        incomingPeriodEnd &&
        existingPeriodEnd &&
        incomingPeriodEnd.getTime() <= existingPeriodEnd.getTime()
      ) {
        return {
          allowed: false,
          reason: 'Cannot resurrect expired subscription without a newer billing period renewal',
        };
      }
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Stale event rejected: subscription is terminal expired; cannot transition to '${incomingStatus}'`,
    };
  }

  // 3. Cancelled state protection
  if (existingStatus === 'cancelled') {
    // A cancelled subscription stays cancelled until it expires or is explicitly reactivated with a newer timestamp
    if (incomingStatus === 'active') {
      if (
        existingLemonUpdatedAt &&
        incomingLemonUpdatedAt.getTime() <= existingLemonUpdatedAt.getTime()
      ) {
        return {
          allowed: false,
          reason: 'Stale active event cannot revert explicitly cancelled subscription without newer timestamp',
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Evaluates whether a subscription grants active commercial entitlement.
 * Preserves access through the paid billing period even if cancelled.
 */
export function isSubscriptionEntitled(sub: {
  status: string;
  currentPeriodEnd?: Date | null;
  endsAt?: Date | null;
  now?: Date;
}): boolean {
  const now = sub.now ?? new Date();
  const status = sub.status.toLowerCase();

  if (status === 'active' || status === 'on_trial') {
    return true;
  }

  if (status === 'cancelled') {
    // Active until the paid period ends
    const cutoff = sub.endsAt ?? sub.currentPeriodEnd;
    if (cutoff && now.getTime() <= cutoff.getTime()) {
      return true;
    }
    return false;
  }

  if (status === 'past_due') {
    // 7-day grace period from period end
    if (sub.currentPeriodEnd) {
      const gracePeriodMs = 7 * 24 * 60 * 60 * 1000;
      if (now.getTime() <= sub.currentPeriodEnd.getTime() + gracePeriodMs) {
        return true;
      }
    }
    return false;
  }

  // 'expired', 'paused', 'unpaid', etc. are not entitled
  return false;
}

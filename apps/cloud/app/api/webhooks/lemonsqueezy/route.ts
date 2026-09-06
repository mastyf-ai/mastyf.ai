import { NextResponse } from 'next/server';
import {
  verifyLemonSqueezySignature,
  hashPayload,
  webhookEventName,
  parseSubscriptionEvent,
  parseLicenseKeyCreated,
  LemonSqueezyWebhookPayload,
} from '@/lib/lemonsqueezy-webhook';
import {
  recordWebhookEvent,
  projectSubscription,
  projectLicenseKey,
} from '@/lib/commercial-projection';

export async function POST(request: Request) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[LemonSqueezy Webhook] LEMONSQUEEZY_WEBHOOK_SECRET is not configured');
    return NextResponse.json(
      { error: 'Webhook secret is not configured' },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-signature');

  // 1. Strict Raw-Body HMAC-SHA256 Signature Verification
  const isValid = verifyLemonSqueezySignature(rawBody, signatureHeader, secret);
  if (!isValid) {
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 },
    );
  }

  let payload: LemonSqueezyWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: 'Malformed JSON payload' },
      { status: 400 },
    );
  }

  const eventName = webhookEventName(payload, request.headers.get('x-event-name'));
  const payloadHash = hashPayload(rawBody);

  // Derive stable event ID for strict deduplication
  const headerEventId = request.headers.get('x-event-id');
  const metaEventId = typeof payload.meta?.custom_data?.event_id === 'string'
    ? payload.meta.custom_data.event_id
    : undefined;
  const eventId = headerEventId || metaEventId || `evt_${payloadHash}`;

  // 2. Strict Event Idempotency Check
  const timestampRaw = payload.data?.attributes?.updated_at ?? payload.data?.attributes?.created_at;
  const eventTimestamp = typeof timestampRaw === 'string' ? new Date(timestampRaw) : new Date();

  const idempotency = await recordWebhookEvent({
    eventId,
    eventName,
    payloadHash,
    eventTimestamp,
  });

  if (!idempotency.isNew) {
    return NextResponse.json({
      received: true,
      duplicate: true,
      eventId,
      eventName,
      message: 'Event already processed',
    });
  }

  // 3. Process Subscription Lifecycle Events
  if (eventName.startsWith('subscription_')) {
    const parsedSub = parseSubscriptionEvent(payload);
    if (!parsedSub) {
      return NextResponse.json({
        received: true,
        ignored: true,
        reason: 'Unparseable subscription payload',
      });
    }

    const res = await projectSubscription(parsedSub);
    return NextResponse.json({
      received: true,
      eventId,
      eventName,
      action: res.action,
      reason: res.reason,
      customerId: res.customerId,
      subscriptionId: res.subscriptionId,
    });
  }

  // 4. Process License Key Events
  if (eventName.startsWith('license_key_')) {
    const parsedLic = parseLicenseKeyCreated(payload);
    if (!parsedLic) {
      return NextResponse.json({
        received: true,
        ignored: true,
        reason: 'Unparseable license key payload',
      });
    }

    const res = await projectLicenseKey(parsedLic);
    return NextResponse.json({
      received: true,
      eventId,
      eventName,
      action: res.action,
      entitlementId: res.entitlementId,
    });
  }

  // 5. Default Acknowledgment for Other Events (e.g. order_created, order_refunded)
  return NextResponse.json({
    received: true,
    eventId,
    eventName,
    message: 'Event received and logged',
  });
}

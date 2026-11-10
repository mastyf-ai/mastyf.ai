import { NextResponse } from 'next/server';
import { findOrder, fulfillOrder } from '@/lib/billing/fulfillment';
import { razorpayCredentials, verifyPaymentSignature } from '@/lib/razorpay';
import { safeAuth } from '@/lib/safe-auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function field(body: Record<string, unknown> | null, name: string): string {
  const value = body?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * POST /api/billing/verify-payment — the Checkout success handler posts razorpay_order_id,
 * razorpay_payment_id and razorpay_signature here. Access is granted only when the signature
 * matches; the license key, when one was just created, is returned once to the buyer.
 */
export async function POST(request: Request) {
  const session = await safeAuth();
  const userId = session?.user?.id;
  if (!userId) return fail('Sign in to finish the payment.', 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const orderId = field(body, 'razorpay_order_id');
  const paymentId = field(body, 'razorpay_payment_id');
  const signature = field(body, 'razorpay_signature');
  if (!orderId || !paymentId || !signature) {
    return fail('razorpay_order_id, razorpay_payment_id and razorpay_signature are required.', 400);
  }

  const credentials = razorpayCredentials();
  if (!credentials) return fail('Payments are not available on this deployment right now.', 503);

  if (!verifyPaymentSignature({ orderId, paymentId, signature }, credentials.keySecret)) {
    console.warn('[billing] payment signature mismatch', { orderId, paymentId });
    return fail('The payment could not be verified, so the plan was not activated. If money left your account, contact support.', 400);
  }

  try {
    const order = await findOrder(orderId);
    if (!order) return fail('Unknown order.', 404);
    // The license key in the response belongs to the buyer alone.
    if (order.userId !== userId) return fail('This order belongs to another account.', 403);

    const result = await fulfillOrder(orderId, paymentId);
    if (result.status === 'unknown_order') return fail('Unknown order.', 404);
    if (result.status === 'already_paid') {
      return NextResponse.json({ paid: true, plan: order.plan, licenseKey: null }, { headers: NO_STORE });
    }
    return NextResponse.json(
      {
        paid: true,
        plan: result.order.plan,
        expiresAt: result.expiresAt.toISOString(),
        licenseKey: result.licenseKey,
        offerEndedDays: result.offerEnded ? result.days : undefined,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error('[billing] could not record a verified payment', { orderId, paymentId }, error);
    return fail('Your payment went through, but we could not activate the plan yet. It will activate shortly; contact support if it does not.', 500);
  }
}

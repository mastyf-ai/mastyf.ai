'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BillingPeriod, PaidPlanId } from '@/lib/billing/plans';
import { formatDate } from '@/lib/format';
import { LicenseKeyReveal } from './LicenseKeyReveal';

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

type CheckoutSuccess = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type CheckoutFailure = { error?: { description?: string } };
type CheckoutInstance = { open(): void; on(event: 'payment.failed', handler: (r: CheckoutFailure) => void): void };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => CheckoutInstance;
  }
}

type OrderResponse = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  plan: { id: PaidPlanId; name: string; period: BillingPeriod };
  prefill: { name: string; email: string };
};
type VerifyResponse = { paid: true; expiresAt?: string; licenseKey: string | null };

type Status =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'verifying' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }
  | { kind: 'paid'; expiresAt: string | null; licenseKey: string | null };

let checkoutScript: Promise<void> | null = null;

/** Loads Razorpay's checkout.js once, on first use, so pages without a purchase never fetch it. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  checkoutScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      checkoutScript = null;
      reject(new Error('Could not load Razorpay Checkout. Check your connection or ad blocker, then try again.'));
    };
    // A blocked or stalled script must not leave the button waiting with no message.
    const timer = setTimeout(fail, 15_000);
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = fail;
    document.body.appendChild(script);
  });
  return checkoutScript;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data as T;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

/**
 * Buys a month or a year of a plan with Razorpay Standard Checkout: create the order on our server,
 * open the payment modal, then have the server verify the signature before anything is unlocked.
 */
export function RazorpayCheckoutButton({
  plan,
  period = 'monthly',
  label,
  signedIn,
  className = 'btn',
}: {
  plan: PaidPlanId;
  period?: BillingPeriod;
  label: string;
  signedIn: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function verify(response: CheckoutSuccess) {
    setStatus({ kind: 'verifying' });
    try {
      const result = await postJson<VerifyResponse>('/api/billing/verify-payment', response);
      setStatus({ kind: 'paid', expiresAt: result.expiresAt ?? null, licenseKey: result.licenseKey });
      router.refresh();
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) });
    }
  }

  async function start() {
    if (!signedIn) {
      router.push(`/login?callbackUrl=${encodeURIComponent('/dashboard/license')}`);
      return;
    }
    setStatus({ kind: 'opening' });
    try {
      const [order] = await Promise.all([
        postJson<OrderResponse>('/api/billing/create-order', { plan, period }),
        loadCheckout(),
      ]);
      if (!window.Razorpay) throw new Error('Razorpay Checkout did not load. Try again.');

      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Mastyf',
        description: `${order.plan.name}, ${order.plan.period === 'yearly' ? '1 year' : '30 days'}`,
        prefill: order.prefill,
        handler: verify,
        modal: {
          // Closing the modal without paying. A failed attempt keeps its error message.
          ondismiss: () => setStatus((s) => (s.kind === 'opening' ? { kind: 'cancelled' } : s)),
        },
      });
      checkout.on('payment.failed', (response) => {
        setStatus({
          kind: 'error',
          message: response.error?.description || 'The payment failed. Try again or use another method.',
        });
      });
      checkout.open();
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) });
    }
  }

  const busy = status.kind === 'opening' || status.kind === 'verifying';

  return (
    <div className="checkout">
      <button type="button" className={className} onClick={start} disabled={busy} aria-busy={busy}>
        {status.kind === 'verifying' ? 'Confirming payment…' : label}
      </button>

      {status.kind === 'cancelled' ? (
        <p className="notice" role="status">
          Payment cancelled. Nothing was charged.
        </p>
      ) : null}
      {status.kind === 'error' ? (
        <p className="notice notice--error" role="alert">
          {status.message}
        </p>
      ) : null}
      {status.kind === 'paid' ? (
        <div className="notice notice--ok" role="status">
          <p className="checkout__done">
            <strong>Payment received.</strong>{' '}
            {status.expiresAt ? `Your plan is active until ${formatDate(status.expiresAt)}.` : 'Your plan is active.'}{' '}
            <Link href="/dashboard/license">View license</Link>
          </p>
          {status.licenseKey ? (
            <LicenseKeyReveal licenseKey={status.licenseKey} />
          ) : (
            <p className="checkout__done">
              Your license key keeps working with the new dates. Don&rsquo;t have it? Create a new one on the License
              page.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { RazorpayCheckoutButton } from '@/components/billing/RazorpayCheckoutButton';
import { Flip } from '@/components/ui/Flip';
import type { DeveloperOffer } from '@/lib/billing/fulfillment';
import { DEVELOPER_OFFER_PLACES, formatPlanPrice, isPaidPlanId, type BillingPeriod } from '@/lib/billing/plans';
import { PRICING_TIERS } from './stats';

const PERIODS: { id: BillingPeriod; label: string; per: string }[] = [
  { id: 'monthly', label: 'Monthly', per: 'per month' },
  { id: 'yearly', label: 'Yearly', per: 'per year' },
];

function placesText(places: number | null): string {
  if (places === null) return `First ${DEVELOPER_OFFER_PLACES} customers.`;
  return `First ${DEVELOPER_OFFER_PLACES} customers, ${places} ${places === 1 ? 'place' : 'places'} left.`;
}

/**
 * The plans at a glance. Full feature lists live in the docs (#plans). `offer` comes from real
 * payments; null means it couldn't be read, so the count is left out rather than guessed.
 */
export function PricingSection({
  signedIn = false,
  offer = null,
}: {
  signedIn?: boolean;
  offer?: Pick<DeveloperOffer, 'open' | 'placesLeft'> | null;
}) {
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const per = PERIODS.find((p) => p.id === period)!.per;
  const offerOpen = offer?.open ?? true;
  const places = offer?.open && offer.placesLeft > 0 ? offer.placesLeft : null;

  return (
    <section className="section section--flush-top" id="pricing" aria-label="Plans">
      <div className="billing-switch">
        <div className="tablist tablist--boxed" role="group" aria-label="Billing period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="tab"
              aria-pressed={period === p.id}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tiers tiers--crisp" data-reveal>
        {PRICING_TIERS.map((tier) => {
          const buttonClass = `btn ${tier.featured ? 'btn-primary' : 'btn-secondary'}`;
          const paid = isPaidPlanId(tier.id);
          const showOffer = tier.id === 'developer' && offerOpen;
          return (
            <article key={tier.id} className={`tier${tier.featured ? ' tier--featured' : ''}`}>
              <div className="tier__head">
                <h2 className="tier__name">
                  <Flip light="var(--accent)">{tier.name}</Flip>
                </h2>
                {showOffer ? (
                  <span className="status status--active">
                    <span className="status__mark" aria-hidden="true">●</span>
                    Launch offer
                  </span>
                ) : null}
              </div>
              <p className="tier__price">
                <span className="tier__amount">
                  {isPaidPlanId(tier.id) ? formatPlanPrice(tier.id, period, showOffer) : tier.price}
                </span>
                <span className="tier__billing">{paid ? per : tier.billing}</span>
              </p>
              {showOffer ? (
                <p className="tier__offer">
                  {placesText(places)} Then {formatPlanPrice('developer', period)} {per}.
                </p>
              ) : null}
              <p className="tier__desc">{tier.audience}</p>

              <ul className="tier__list">
                {tier.highlights.map((item) => (
                  <li key={item}>
                    <Check size={13} strokeWidth={2} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="tier__cta">
                {isPaidPlanId(tier.id) ? (
                  <RazorpayCheckoutButton
                    plan={tier.id}
                    period={period}
                    signedIn={signedIn}
                    label={signedIn ? tier.shortCta : `Sign in to buy`}
                    className={buttonClass}
                  />
                ) : tier.external ? (
                  <a href={tier.href} className={buttonClass} target="_blank" rel="noopener noreferrer">
                    {tier.shortCta}
                  </a>
                ) : (
                  <Link href={tier.href} className={buttonClass}>
                    {tier.shortCta}
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="pricing-foot">
        <Link href="/docs/plans" className="link-icon">
          Compare every feature
          <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <Link href="/docs/help#faq" className="link-icon">
          Questions and answers
          <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <span>Payments by Razorpay (UPI, cards, netbanking). Your license key appears right after payment.</span>
      </div>
    </section>
  );
}

import Link from 'next/link';
import { Check } from 'lucide-react';

/**
 * How to get Authority today. The open-source core is free; paid help (connectors, the production model,
 * the shadow-mode pilot) is arranged with us, as there is no Authority checkout on the site yet.
 */

const PLANS = [
  {
    id: 'community',
    name: 'Community',
    who: 'Run it yourself',
    price: '₹0',
    unit: 'AGPL-3.0',
    bullets: [
      'Decision engine, risk model and key vault',
      'Damage ceilings and limits you set',
      'Runs on your own servers',
      'Read it, run it, break it',
    ],
    cta: { label: 'Get it on GitHub', href: 'https://github.com/mastyf-ai/mastyf-authority', external: true },
    featured: false,
  },
  {
    id: 'pilot',
    name: 'Pilot',
    who: 'For security teams',
    price: 'Talk to us',
    unit: 'shadow mode first',
    bullets: [
      'Connectors for your logs and apps',
      'The production risk model',
      'Shadow-mode pilot: scores what Authority would do, blocks nothing',
      'Our time, until you switch enforcement on',
    ],
    cta: { label: 'Join the pilot', href: '/pilot', external: false },
    featured: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    who: 'Larger and regulated companies',
    price: 'Custom',
    unit: 'terms agreed with you',
    bullets: [
      'Enterprise add-ons',
      'Commercial licence instead of the AGPL-3.0',
      'Private or on-premises deployment',
    ],
    cta: { label: 'Talk to us', href: '/pilot', external: false },
    featured: false,
  },
] as const;

export function AuthorityPricing() {
  return (
    <div className="ap">
      <div className="ap__grid ap__grid--three">
        {PLANS.map((p) => (
          <article key={p.id} className={`ap__card${p.featured ? ' ap__card--hi' : ''}`}>
            {p.featured ? <p className="ap__badge">Best way to start</p> : null}
            <h3>{p.name}</h3>
            <p className="ap__who">{p.who}</p>
            <p className="ap__price">
              <strong>{p.price}</strong>
              <span>{p.unit}</span>
            </p>
            <ul>
              {p.bullets.map((b) => (
                <li key={b}><Check size={15} strokeWidth={2} aria-hidden="true" /><span>{b}</span></li>
              ))}
            </ul>
            <div className="ap__cta">
              {p.cta.external ? (
                <a className={`btn${p.featured ? ' btn-primary' : ''}`} href={p.cta.href} target="_blank" rel="noopener noreferrer">
                  {p.cta.label}
                </a>
              ) : (
                <Link className={`btn${p.featured ? ' btn-primary' : ''}`} href={p.cta.href}>{p.cta.label}</Link>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="ap__report">
        <div>
          <strong>Damage Ceiling Report</strong>
          <span>
            Free for our first 10 companies: send 30 days of read-only logs and get the most a stolen login could take,
            per account, in 48 hours.
          </span>
        </div>
        <div className="ap__report-cta">
          <a className="btn" href="#report">Request free report</a>
        </div>
      </div>

      <p className="ap__fine">
        Research preview: Authority starts in shadow mode, so nothing is blocked until you switch enforcement on
        together with us. Shield plans are on <Link href="/pricing">mastyf.ai/pricing</Link>.
      </p>
    </div>
  );
}

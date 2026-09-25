import Link from 'next/link';
import { PRICING_TIERS } from './stats';

export function PricingSection() {
  return (
    <section className="lp-section" id="pricing" aria-label="Pricing">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Transparent Commercial Model</span>
        <h2>Predictable Platform &amp; Governance Licensing</h2>
        <p>
          Self-host the open-source Gateway for free, or scale with enterprise fleet governance, continuous adversarial testing, and dedicated SLA support.
        </p>
      </div>

      <div className="lp-pricing-grid lp-pricing-grid-5">
        {PRICING_TIERS.map((tier) => (
          <div
            key={tier.id}
            className={`card lp-pricing-card ${tier.featured ? 'lp-pricing-featured' : ''}`}
          >
            {tier.featured && <span className="lp-pricing-badge">Most Popular</span>}
            <div className="lp-pricing-top">
              <h3 className="lp-pricing-name">{tier.name}</h3>
              <div className="lp-pricing-cost">
                <span className="lp-pricing-amount">{tier.price}</span>
                <span className="lp-pricing-billing">{tier.billing}</span>
              </div>
              <p className="lp-pricing-desc muted">{tier.description}</p>
            </div>

            <ul className="lp-pricing-features">
              {tier.bullets.map((b) => (
                <li key={b}>
                  <span className="lp-pricing-check" aria-hidden>✓</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>

            <div className="lp-pricing-cta">
              {tier.external ? (
                <a
                  href={tier.href}
                  className="btn btn-ghost btn-pill w-full"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {tier.cta}
                </a>
              ) : (
                <Link
                  href={tier.href}
                  className={`btn ${tier.featured ? 'btn-primary' : 'btn-secondary'} btn-pill w-full`}
                >
                  {tier.cta}
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="lp-licensing-duality card">
        <div className="lp-duality-col">
          <span className="lp-pill">Open Source Core</span>
          <h4>Build. Inspect. Self-Host.</h4>
          <p className="muted">
            The core Mastyf Gateway, YAML policy engine, Security Swarm fixtures, and MCP Trust directory are 100% open source under AGPL-3.0. No vendor lock-in; verify every line of security enforcement yourself.
          </p>
          <a
            href="https://github.com/mastyf-ai/mastyf.ai"
            className="text-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            Inspect GitHub Repository →
          </a>
        </div>
        <div className="lp-duality-divider" aria-hidden="true" />
        <div className="lp-duality-col">
          <span className="lp-pill lp-pill-gold">Commercial Platform</span>
          <h4>Operate. Govern. Scale.</h4>
          <p className="muted">
            Enterprises pay for centralized Control Plane fleet management, tamper-evident cryptographic evidence, production Mastyf Guard models, automated compliance exports, and enterprise SLAs.
          </p>
          <Link href="/pilot" className="text-link">
            Learn About the 30-Day Pilot Program →
          </Link>
        </div>
      </div>
      <div className="card p-6 mt-8 flex flex-col md:flex-row justify-between items-center gap-4 bg-black/40 border border-white/5">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block mb-1">
            Global Merchant of Record &amp; Payment Security
          </span>
          <p className="text-xs text-slate-300 m-0">
            All credit card, debit card, Apple Pay, and bank payments are securely processed by <strong>Lemon Squeezy</strong> with 256-bit SSL encryption, global VAT/sales tax compliance, and instant license key delivery.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href="https://mastyfai.lemonsqueezy.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm btn-pill text-xs whitespace-nowrap"
          >
            Visit Lemon Squeezy Storefront ↗
          </a>
        </div>
      </div>
    </section>
  );
}

import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { PRICING_TIERS } from '@/components/landing/stats';
import { GITHUB_REPO_URL } from '@/lib/github-links';

/** Every plan's full feature list, plus how licensing and payment work. */
export function Plans() {
  return (
    <>
      <div className="table-scroll">
        <table className="data-table plans">
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Includes</th>
            </tr>
          </thead>
          <tbody>
            {PRICING_TIERS.map((tier) => (
              <tr key={tier.id} id={`plan-${tier.id}`}>
                <th scope="row">
                  <span className="plans__name">{tier.name}</span>
                  <span className="plans__price">
                    {tier.price}
                    <span>{tier.billing}</span>
                  </span>
                  <span className="plans__for">{tier.description}</span>
                </th>
                <td>
                  <ul className="doc-bullets">
                    {tier.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="doc-columns">
        <div>
          <h3>Open source core</h3>
          <p>
            The Mastyf Gateway, YAML policy engine, Security Swarm fixtures, and MCP Trust directory are open source under
            AGPL-3.0. No vendor lock-in: you can read every line of the enforcement code.
          </p>
          <a href={GITHUB_REPO_URL} className="link-icon" target="_blank" rel="noopener noreferrer">
            GitHub repository
            <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
        <div>
          <h3>Commercial platform</h3>
          <p>
            Paid plans add the Control Plane for fleets, tamper-evident audit evidence, production Mastyf Guard models,
            compliance exports, and support SLAs.
          </p>
        </div>
      </div>

      <h3 className="doc-subhead">Payment</h3>
      <p>
        Payments are processed by Razorpay in Indian rupees (UPI, cards, netbanking and wallets). A monthly payment buys
        30 days of the plan for your workspace and a yearly payment buys 365, and paying again extends it. Plans do not
        renew by themselves. Your license key for Shield and the gateway appears right after the first payment and stays
        on the License page of your dashboard.
      </p>
      <p>
        A Developer Pro key works on one device. To move it to another device, create a new key on the License page; the
        old device stops working. The first 100 Developer Pro customers keep the launch price for 12 months from their
        first payment, then move to the normal price.
      </p>
      <Link href="/pricing" className="link-icon">
        See plans and buy
        <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </>
  );
}

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
          <h3>Free and open source</h3>
          <p>
            The check program and its rules engine are open source under AGPL-3.0, and the libraries under MIT. You can
            read every line of the code that decides.
          </p>
          <a href={GITHUB_REPO_URL} className="link-icon" target="_blank" rel="noopener noreferrer">
            GitHub repository
            <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
        <div>
          <h3>Paid</h3>
          <p>
            Paid plans add the Shield app, Protocol X, DIFC taint tracking, the argument-intent auditor, the causal gate,
            signed receipts for every block, and your dashboard on mastyf.ai.
          </p>
        </div>
      </div>

      <h3 className="doc-subhead">Payment</h3>
      <p>
        Payments are processed by Razorpay in Indian rupees (UPI, cards, netbanking and wallets). A monthly payment buys
        30 days of the plan for your workspace and a yearly payment buys 365, and paying again extends it. Plans do not
        renew by themselves. Your license key for Shield appears right after the first payment and stays
        on the License page of your dashboard.
      </p>
      <p>
        Every key works on one device. To move a key, create a new key on the License page; the old device stops working
        at its next license check. The first 100 Developer Pro customers keep the launch price
        for 12 months from their first payment, then move to the normal price. Only completed payments take a place. A
        payment that arrives after the offer has gone buys the days it is worth at the normal price.
      </p>
      <Link href="/pricing" className="link-icon">
        See plans and buy
        <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </>
  );
}

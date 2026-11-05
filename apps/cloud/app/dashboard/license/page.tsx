import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PLAN_FOR_TIER } from '@/components/dashboard/plans';
import { PRICING_TIERS } from '@/components/landing/stats';
import { NewLicenseKeyButton } from '@/components/billing/NewLicenseKeyButton';
import { RazorpayCheckoutButton } from '@/components/billing/RazorpayCheckoutButton';
import { ShieldDownloadButtons } from '@/components/download/ShieldDownloadButtons';
import { issuedLicenseSummary } from '@/lib/billing/license-keys';
import { isPaidPlanId } from '@/lib/billing/plans';
import { activeLicense, listInstances, listTeams, requireDashboard } from '@/lib/dashboard-data';
import { formatCount, formatDate } from '@/lib/format';

/** A limit of 0 or less from the licenses table means unlimited for paid tiers. */
function limitLabel(used: number, max: number, unlimited: boolean): string {
  return unlimited || max <= 0 ? `${formatCount(used)} (no limit)` : `${formatCount(used)} of ${formatCount(max)}`;
}

export default async function LicensePage() {
  const { session, ctx } = await requireDashboard();
  const orgId = ctx.org.id;
  const email = session.user.email;
  const [license, instances, teams, licenseKey] = await Promise.all([
    activeLicense(orgId),
    listInstances(orgId),
    listTeams(orgId),
    email ? issuedLicenseSummary(email) : null,
  ]);

  const plan = PLAN_FOR_TIER[license.tier];
  const unlimited = license.tier === 'enterprise';

  return (
    <>
      <header className="dhead">
        <div>
          <h1>License</h1>
          <p>Your plan, what it allows, and how much of it you use.</p>
        </div>
        <div className="dhead__actions">
          <Link href="/pricing" className="btn btn-primary">
            Compare plans
            <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="dstack">
        <section className="panel" aria-labelledby="current-plan">
          <div className="panel__head">
            <h2 id="current-plan" className="panel__title">
              {plan.name} plan
            </h2>
            <span className="status status--active">
              <span className="status__mark">●</span>Active
            </span>
          </div>
          <div className="metrics">
            <div className="metric">
              <span className="metric__label">Proxies</span>
              <span className="metric__value">{limitLabel(instances.length, license.maxInstances, unlimited)}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Teams</span>
              <span className="metric__value">{limitLabel(teams.length, license.maxTeams, unlimited)}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Users</span>
              <span className="metric__value">
                {unlimited || license.maxUsers <= 0 ? 'No limit' : `Up to ${formatCount(license.maxUsers)}`}
              </span>
            </div>
            <div className="metric">
              <span className="metric__label">Term</span>
              <span className="metric__value metric__value--text">
                {license.expiresAt ? `Paid through ${formatDate(license.expiresAt)}` : 'No expiry'}
              </span>
              {license.activatedAt ? (
                <span className="metric__note">Since {formatDate(license.activatedAt)}</span>
              ) : null}
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="license-key">
          <div className="panel__head">
            <h2 id="license-key" className="panel__title">
              License key
            </h2>
            {licenseKey ? (
              <span className={`status ${licenseKey.active ? 'status--active' : 'status--warning'}`}>
                <span className="status__mark">●</span>
                {licenseKey.active ? 'Active' : 'Expired'}
              </span>
            ) : null}
          </div>
          <div className="panel__body">
            {licenseKey ? (
              <>
                <dl className="kv">
                  <div>
                    <dt>Key</dt>
                    <dd>
                      <code>{licenseKey.preview ?? 'MG-****'}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{licenseKey.active ? 'Paid through' : 'Expired on'}</dt>
                    <dd>{formatDate(licenseKey.expiresAt?.toISOString()) ?? '—'}</dd>
                  </div>
                </dl>
                <p className="panel__text">
                  Shield and the gateway check this key with Mastyf Cloud and stay unlocked until the date above.
                  Buying again extends it; the key itself does not change.
                </p>
                <NewLicenseKeyButton />
              </>
            ) : (
              <p className="panel__text" style={{ margin: 0 }}>
                Buying Developer Pro or Team gives you a license key for Shield and the gateway.
              </p>
            )}
          </div>
        </section>

        {licenseKey?.active ? (
          <section className="panel" aria-labelledby="download-shield">
            <div className="panel__head">
              <h2 id="download-shield" className="panel__title">
                Download Shield
              </h2>
            </div>
            <div className="panel__body">
              <ShieldDownloadButtons />
            </div>
          </section>
        ) : null}

        <section className="panel" aria-labelledby="plans">
          <div className="panel__head">
            <h2 id="plans" className="panel__title">
              Plans
            </h2>
            <Link href="/docs/plans" className="link-icon">
              Every feature
              <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
          <div className="panel__body panel__body--flush">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Plan</th>
                    <th scope="col">Price</th>
                    <th scope="col" className="col-opt">
                      Highlights
                    </th>
                    <th scope="col">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PRICING_TIERS.map((tier) => {
                    const current = tier.id === plan.pricingId;
                    return (
                      <tr key={tier.id}>
                        <td>
                          {tier.name}
                          <span className="cell-sub">{tier.audience}</span>
                        </td>
                        <td>
                          {tier.price}
                          <span className="cell-sub">{tier.billing}</span>
                        </td>
                        <td className="dim col-opt">{tier.highlights.join(', ')}</td>
                        <td className="num">
                          {isPaidPlanId(tier.id) ? (
                            <RazorpayCheckoutButton
                              plan={tier.id}
                              signedIn
                              label={current ? 'Renew 30 days' : tier.shortCta}
                              className="btn btn-sm"
                            />
                          ) : current ? (
                            <span className="status status--active">Current</span>
                          ) : tier.external ? (
                            <a href={tier.href} className="btn btn-sm" target="_blank" rel="noopener noreferrer">
                              {tier.shortCta}
                            </a>
                          ) : (
                            <Link href={tier.href} className="btn btn-sm">
                              {tier.shortCta}
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

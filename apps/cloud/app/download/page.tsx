import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { GatedDownloadBox } from '@/components/download/GatedDownloadBox';
import { formatPlanPrice } from '@/lib/billing/plans';
import { issuedLicenseSummary } from '@/lib/billing/license-keys';
import { SHIELD_PLATFORM_ORDER, SHIELD_PLATFORMS, SHIELD_VERSION, shieldPlatformAvailable } from '@/lib/billing/shield-builds';
import { cloudDbAvailable } from '@/lib/db';
import { CONTACT_EMAIL } from '@/lib/product-links';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { safeAuth } from '@/lib/safe-auth';

const CHECKOUT_URL = '/pricing';

/** Whether the signed-in visitor's plan covers Shield. Any failure reads as no, which only hides buttons. */
async function hasShieldPlan(email: string | null | undefined): Promise<boolean> {
  if (!email || !cloudDbAvailable()) return false;
  try {
    return (await issuedLicenseSummary(email))?.active ?? false;
  } catch {
    return false;
  }
}

function platformsLabel(): string {
  const names = SHIELD_PLATFORM_ORDER.filter(shieldPlatformAvailable).map((id) => SHIELD_PLATFORMS[id].name);
  const soon = SHIELD_PLATFORM_ORDER.filter((id) => !shieldPlatformAvailable(id)).map((id) => SHIELD_PLATFORMS[id].name);
  return soon.length ? `${names.join(', ')} (${soon.join(' and ')} soon)` : names.join(', ');
}

export const metadata = {
  title: 'Download Mastyf Shield — Mastyf',
  description:
    'Download Mastyf Shield for macOS, Windows, and Linux: a desktop app that checks every tool call Claude Desktop, Cursor, and other local agents make before it runs.',
};

const STEPS = [
  {
    title: 'Get a license key',
    body: (
      <>
        Buy Developer Pro ({formatPlanPrice('developer')} for 30 days) on the <Link href="/pricing">pricing page</Link>.
        The key appears right after payment and stays on your dashboard.
      </>
    ),
  },
  {
    title: 'Install',
    body: (
      <>
        macOS: drag the <code>.dmg</code> to Applications. Windows: run the <code>.exe</code>. Linux: run the{' '}
        <code>.AppImage</code> or install the <code>.deb</code>.
      </>
    ),
  },
  {
    title: 'Activate',
    body: <>Paste the key into the first-launch window. Shield starts checking MCP tool calls right away.</>,
  },
];

const REQUIREMENTS = [
  { os: 'macOS', need: '12 Monterey or newer. Universal build for Apple Silicon (arm64) and Intel (x86_64).' },
  { os: 'Windows', need: 'Windows 10 (build 19041+) or Windows 11, x64 or ARM64.' },
  { os: 'Linux', need: 'glibc 2.28+: Ubuntu 20.04+, Debian 11+, Fedora 34+, Arch.' },
  { os: 'Works with', need: 'Claude Desktop, Cursor, Windsurf, VS Code, and any Model Context Protocol client.' },
];

export default async function DownloadPage() {
  const session = await safeAuth();
  const entitled = await hasShieldPlan(session?.user?.email);

  return (
    <>
      <SiteNav session={!!session} />
      <main className="page-main">
        <header className="page-head page-head--split">
          <div>
            <h1 className="page-head__title">Download Mastyf Shield</h1>
            <p className="page-head__lead">
              A desktop app that sits between your local agents and their tools. Every tool call Claude Desktop, Cursor
              or Windsurf makes is checked against your policy before it runs.
            </p>
            <dl className="facts">
              <div>
                <dt>Version</dt>
                <dd>{SHIELD_VERSION}</dd>
              </div>
              <div>
                <dt>Platforms</dt>
                <dd>{platformsLabel()}</dd>
              </div>
              <div>
                <dt>Decision</dt>
                <dd>Under 4.8 µs, on device</dd>
              </div>
            </dl>
          </div>

          <GatedDownloadBox entitled={entitled} signedIn={!!session} checkoutUrl={CHECKOUT_URL} />
        </header>

        <section className="section" aria-labelledby="setup-title">
          <h2 id="setup-title" className="section__title">
            Set up in three steps
          </h2>
          <ol className="step-row">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="step-row__n">{i + 1}</span>
                <span>
                  <strong>{step.title}</strong>
                  {step.body}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" aria-labelledby="requirements-title">
          <div className="dl-more">
            <div>
              <h2 id="requirements-title" className="section__title">
                Requirements
              </h2>
              <div className="table-scroll">
                <table className="data-table">
                  <tbody>
                    {REQUIREMENTS.map((row) => (
                      <tr key={row.os}>
                        <th scope="row">{row.os}</th>
                        <td>{row.need}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="section__title">Other ways to run Mastyf</h2>
              <ul className="dl-alt">
                <li>
                  <span>
                    <strong>Open source CLI.</strong> The Gateway, policy engine and Swarm fixtures are free under
                    AGPL-3.0, no Shield license needed.
                  </span>
                  <span className="dl-alt__links">
                    <Link href="/developers" className="link-icon">
                      Developer quickstart
                      <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
                    </Link>
                    <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="link-icon">
                      GitHub
                      <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
                    </a>
                  </span>
                </li>
                <li>
                  <span>
                    <strong>A whole fleet.</strong> Kubernetes sidecars and managed distribution for teams.
                  </span>
                  <span className="dl-alt__links">
                    <Link href="/pilot" className="link-icon">
                      30-day pilot
                      <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
                    </Link>
                    <a href={`mailto:${CONTACT_EMAIL}`} className="link-icon">
                      {CONTACT_EMAIL}
                    </a>
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

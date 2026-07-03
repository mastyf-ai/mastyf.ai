import Link from 'next/link';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';
import { RevealOnScroll } from './RevealOnScroll';

type Props = {
  session: boolean;
};

export function CloudCtaSection({ session }: Props) {
  return (
    <RevealOnScroll>
      <section className="lp-section lp-section-tint" id="cloud">
        <div className="lp-cloud card-elevated">
          <div>
            <h2>Cloud console</h2>
            <p className="muted">
              Sign in with Google or GitHub to edit policy YAML, copy tenant env snippets, rotate API
              keys, and manage your fleet. Free — no credit card.
            </p>
          </div>
          <div className="lp-cloud-actions">
            {session ? (
              <Link href="/dashboard" className="btn btn-primary btn-pill">
                Go to dashboard
              </Link>
            ) : (
              <Link href="/login" className="btn btn-primary btn-pill">
                Sign in free
              </Link>
            )}
            <Link href="/dashboard/connect" className="btn btn-secondary btn-pill">
              Connect self-hosted proxy
            </Link>
          </div>
        </div>
      </section>
    </RevealOnScroll>
  );
}

export function CtaSection({ session }: Props) {
  return (
    <RevealOnScroll>
      <section className="lp-cta-band" id="contact">
        <div className="lp-cta-inner">
          <div className="lp-contact-block">
            <h2>Contact us</h2>
            <p className="muted">
              Questions about scores, badges, the cloud console, or privacy requests?
            </p>
            <a href={SUPPORT_MAILTO} className="btn btn-gold btn-pill">
              Email {SUPPORT_EMAIL}
            </a>
          </div>
          <div className="lp-final-block">
            <h2>Ready to score your MCP servers?</h2>
            <p className="muted">Look up any npm package free — no account required.</p>
            <div className="lp-final-actions">
              <Link href="/certified" className="btn btn-primary btn-pill">
                Look up a package
              </Link>
              {!session ? (
                <Link href="/login" className="btn btn-secondary btn-pill">
                  Sign in free
                </Link>
              ) : null}
              <a href={GITHUB_REPO_URL} className="btn btn-ghost btn-pill" rel="noopener noreferrer">
                GitHub
              </a>
            </div>
          </div>
        </div>
      </section>
    </RevealOnScroll>
  );
}

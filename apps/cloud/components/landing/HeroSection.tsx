import Link from 'next/link';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { HeroProofStack } from './demos/HeroProofStack';
import { HERO_HEADLINE, HERO_LEAD, HERO_TRUST_ITEMS, HERO_VALUE_PILLARS } from './stats';

type Props = {
  session: boolean;
};

export function HeroSection({ session }: Props) {
  return (
    <header className="lp-hero lp-hero-premium" id="top">
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">
            <span className="lp-pill">MCP security platform</span>
            <span className="lp-pill lp-pill-gold">Open source</span>
          </p>

          <h1 className="lp-hero-title">
            {HERO_HEADLINE.line1}
            <br />
            <span className="lp-hero-accent">{HERO_HEADLINE.line2}</span>
          </h1>

          <p className="lp-hero-lead">{HERO_LEAD}</p>

          <ul className="lp-hero-pillars">
            {HERO_VALUE_PILLARS.map((p) => (
              <li key={p.id}>
                <strong>{p.title}</strong>
                <span>{p.body}</span>
              </li>
            ))}
          </ul>

          <div className="lp-hero-cta">
            <Link href="/certified" className="btn btn-primary btn-pill motion-cta">
              Look up a package
            </Link>
            {session ? (
              <Link href="/dashboard" className="btn btn-secondary btn-pill motion-cta">
                Cloud console
              </Link>
            ) : (
              <Link href="/login" className="btn btn-secondary btn-pill motion-cta">
                Sign in free
              </Link>
            )}
            <a href={GITHUB_REPO_URL} className="btn btn-ghost btn-pill motion-cta" rel="noopener noreferrer">
              View on GitHub
            </a>
          </div>

          <div className="lp-hero-trust" aria-label="Trust signals">
            {HERO_TRUST_ITEMS.map((item) => (
              <a key={item.label} href={item.href} className="lp-hero-trust-item">
                <span className="lp-hero-trust-check" aria-hidden>✓</span>
                {item.label}
              </a>
            ))}
          </div>
        </div>

        <HeroProofStack />
      </div>
    </header>
  );
}

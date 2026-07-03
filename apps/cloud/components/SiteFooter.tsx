import Image from 'next/image';
import Link from 'next/link';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { SITE_NAME } from '@/lib/product-links';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';

const TRUST_BADGES = [
  { label: '228/228 corpus gates', detail: '0 bypasses' },
  { label: 'Open source', detail: 'MIT licensed' },
  { label: 'Defense Fabric', detail: '6-phase protection' },
  { label: 'Evidence packs', detail: 'Enterprise ready' },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer site-footer-premium" id="contact">
      <div className="site-footer-trust-band">
        {TRUST_BADGES.map((b) => (
          <div key={b.label} className="site-footer-trust-item">
            <strong>{b.label}</strong>
            <span>{b.detail}</span>
          </div>
        ))}
      </div>

      <div className="site-footer-grid">
        <div className="site-footer-brand">
          <Image
            src="/logo-wordmark.png"
            alt={SITE_NAME}
            width={208}
            height={52}
            className="site-footer-wordmark"
          />
          <p className="site-footer-tagline">
            Perimeter security for AI agents. Runtime enforcement, Defense Fabric, trust scores,
            and a self-improving Security Swarm — open source and enterprise-ready.
          </p>
          <a href={SUPPORT_MAILTO} className="site-footer-email">
            {SUPPORT_EMAIL}
          </a>
        </div>

        <div className="site-footer-col">
          <h4>Product</h4>
          <ul>
            <li>
              <Link href="/certified">Trust scores</Link>
            </li>
            <li>
              <Link href="/dashboard">Cloud console</Link>
            </li>
            <li>
              <Link href="/login">Sign in free</Link>
            </li>
            <li>
              <a href="/#product">Platform overview</a>
            </li>
            <li>
              <a href="/#architecture">Defense Fabric</a>
            </li>
          </ul>
        </div>

        <div className="site-footer-col">
          <h4>Resources</h4>
          <ul>
            <li>
              <a href={GITHUB_REPO_URL} rel="noopener noreferrer">
                GitHub
              </a>
            </li>
            <li>
              <a href="/openapi.yaml">API docs</a>
            </li>
            <li>
              <Link href="/tutorials/site-walkthrough">Walkthrough</Link>
            </li>
            <li>
              <a href="https://github.com/mastyf-ai/mastyf.ai/blob/main/docs/ENTERPRISE_EVIDENCE_PACK.md" rel="noopener noreferrer">
                Evidence pack
              </a>
            </li>
          </ul>
        </div>

        <div className="site-footer-col">
          <h4>Company</h4>
          <ul>
            <li>
              <a href={SUPPORT_MAILTO}>Contact us</a>
            </li>
            <li>
              <Link href="/terms">Terms</Link>
            </li>
            <li>
              <Link href="/privacy">Privacy</Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="site-footer-bottom">
        <span>© {new Date().getFullYear()} {SITE_NAME}. All rights reserved.</span>
        <span className="site-footer-bottom-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <a href={GITHUB_REPO_URL} rel="noopener noreferrer">
            GitHub
          </a>
        </span>
      </div>
    </footer>
  );
}

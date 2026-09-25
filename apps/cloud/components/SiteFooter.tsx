import Image from 'next/image';
import Link from 'next/link';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import {
  HF_MODEL_URL,
  PAPER_PDF_URL,
  SITE_NAME,
  ZENODO_DOI,
  ZENODO_URL,
} from '@/lib/product-links';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';

const TRUST_BADGES = [
  { label: '99.52% Defense on AgentDojo', detail: '629 episodes · Exact clean utility parity' },
  { label: `DOI 10.5281/zenodo.22501491`, detail: 'Formal Research Monograph · CC-BY 4.0' },
  { label: 'Deterministic CBAC Invariants', detail: '< 4.8µs fast-path · Complete mediation' },
  { label: 'Open Source AGPL-3.0', detail: 'Self-hostable Gateway + Security Swarm' },
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
            Your AI can reason. Mastyf controls what it can execute. An externally enforced security layer for AI agent tool execution, combining runtime authorization, adversarial testing, software trust, and centralized enterprise fleet governance.
          </p>
          <a href={SUPPORT_MAILTO} className="site-footer-email">
            {SUPPORT_EMAIL}
          </a>
        </div>

        <div className="site-footer-col">
          <h4>Platform</h4>
          <ul>
            <li>
              <Link href="/download" className="text-amber-400 font-semibold">Download Shield (Mac, Win, Linux)</Link>
            </li>
            <li>
              <Link href="/certified" className="text-emerald-400 font-semibold">Certified MCPs</Link>
            </li>
            <li>
              <Link href="/platform">Platform Architecture</Link>
            </li>
            <li>
              <Link href="/platform#gateway">Mastyf Gateway</Link>
            </li>
            <li>
              <Link href="/platform#swarm">Mastyf Swarm</Link>
            </li>
            <li>
              <Link href="/trust">Mastyf Trust</Link>
            </li>
            <li>
              <Link href="/platform#control-plane">Control Plane</Link>
            </li>
            <li>
              <Link href="/pricing">Pricing &amp; License</Link>
            </li>
          </ul>
        </div>

        <div className="site-footer-col">
          <h4>Solutions &amp; Devs</h4>
          <ul>
            <li>
              <Link href="/solutions#mcp-security">MCP Security</Link>
            </li>
            <li>
              <Link href="/solutions#coding-agents">Autonomous Coding Agents</Link>
            </li>
            <li>
              <Link href="/solutions#enterprise-agents">Enterprise Data Stores</Link>
            </li>
            <li>
              <Link href="/developers">Developer Quickstart</Link>
            </li>
            <li>
              <Link href="/assessment">Free Security Assessment</Link>
            </li>
            <li>
              <a href={GITHUB_REPO_URL} rel="noopener noreferrer" target="_blank">
                GitHub Repository
              </a>
            </li>
          </ul>
        </div>

        <div className="site-footer-col">
          <h4>Research &amp; Trust</h4>
          <ul>
            <li>
              <Link href="/research">Research &amp; Formal Theorems</Link>
            </li>
            <li>
              <Link href="/research#limitations">Guarantees &amp; Limitations</Link>
            </li>
            <li>
              <Link href="/trust">Trust Center &amp; Compliance</Link>
            </li>
            <li>
              <Link href="/pricing">Pricing &amp; Licensing</Link>
            </li>
            <li>
              <Link href="/pilot">30-Day Guided Pilot</Link>
            </li>
            <li>
              <Link href="/terms">Terms of Service</Link>
            </li>
            <li>
              <Link href="/privacy">Privacy Policy</Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="site-footer-bottom">
        <span>© {new Date().getFullYear()} {SITE_NAME}. All rights reserved.</span>
        <span className="site-footer-bottom-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <a href={GITHUB_REPO_URL} rel="noopener noreferrer" target="_blank">
            GitHub
          </a>
        </span>
      </div>
    </footer>
  );
}

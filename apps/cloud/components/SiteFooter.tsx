import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { MARKETPLACES } from '@/lib/marketplaces';
import { SITE_NAME } from '@/lib/product-links';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';

type FooterLink = { href: string; label: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Platform',
    links: [
      { href: '/download', label: 'Download Shield' },
      { href: '/docs', label: 'Documentation' },
      { href: '/certified', label: 'Certified MCPs' },
      { href: '/docs/python', label: 'Python library' },
      { href: '/docs/check', label: 'Check program' },
      { href: '/protocol-x', label: 'Protocol X' },
      { href: '/attack-lab', label: 'Attack Lab' },
      { href: '/pricing', label: 'Pricing and license' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { href: '/solutions#mcp-security', label: 'MCP security' },
      { href: '/solutions#coding-agents', label: 'Autonomous coding agents' },
      { href: '/solutions#enterprise-agents', label: 'Enterprise data stores' },
      { href: '/docs/getting-started', label: 'Get started' },
      { href: '/assessment', label: 'Check your agent’s risk' },
      { href: GITHUB_REPO_URL, label: 'GitHub repository', external: true },
    ],
  },
  {
    title: 'Research and trust',
    links: [
      { href: '/research', label: 'Read the paper' },
      { href: '/docs/security-model#guarantees', label: 'Guarantees and limitations' },
      { href: '/trust', label: 'Trust center' },
      { href: '/funding', label: 'Funding and support' },
      { href: '/pilot', label: '30-day guided pilot' },
      { href: '/terms', label: 'Terms of service' },
      { href: '/privacy', label: 'Privacy policy' },
    ],
  },
  {
    title: 'Get Mastyf',
    links: MARKETPLACES.map((m) => ({ href: m.href, label: m.name, external: true })),
  },
];

function FooterAnchor({ link }: { link: FooterLink }) {
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer">
        {link.label}
        <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden="true" />
      </a>
    );
  }
  return <Link href={link.href}>{link.label}</Link>;
}

export function SiteFooter() {
  return (
    <footer className="footer" id="contact">
      <div className="footer__main">
        <div className="footer__brand">
          <div className="footer__mark">
            <Image src="/brand/mark-64.png" alt="" width={28} height={28} className="brand-mark" />
            <span>mastyf.ai</span>
          </div>
          <p>
            Mastyf guards every action your AI agents take, and checks it against your rules before it runs.
          </p>
          <a href={SUPPORT_MAILTO} className="footer__email">
            {SUPPORT_EMAIL}
          </a>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} className="footer__col" aria-label={column.title}>
            <h2 className="footer__heading">{column.title}</h2>
            <ul>
              {column.links.map((link) => (
                <li key={link.href + link.label}>
                  <FooterAnchor link={link} />
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="footer__bottom">
        <span>
          © {new Date().getFullYear()} {SITE_NAME}
        </span>
        <span className="footer__bottom-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </span>
      </div>
    </footer>
  );
}

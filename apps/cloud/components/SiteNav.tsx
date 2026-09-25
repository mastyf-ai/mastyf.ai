'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GITHUB_REPO_URL } from '@/lib/github-links';

type Props = {
  session: boolean;
};

const NAV_TABS = [
  { href: '/platform', label: 'Platform' },
  { href: '/download', label: 'Download Shield' },
  { href: '/certified', label: 'Certified' },
  { href: '/solutions', label: 'Solutions' },
  { href: '/developers', label: 'Developers' },
  { href: '/research', label: 'Research' },
  { href: '/trust', label: 'Trust' },
  { href: '/pricing', label: 'Pricing' },
];

export function SiteNav({ session }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 16);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`site-nav site-nav-premium${scrolled ? ' site-nav-scrolled site-nav-island' : ''}`}>
      <div className="site-nav-inner">
        <Link href="/" className="brand" aria-label="Mastyf AI Agent Security Platform">
          <Image
            src="/logo-wordmark.png"
            alt="Mastyf AI"
            width={240}
            height={56}
            className="brand-wordmark"
            priority
          />
          <Image src="/logo.png" alt="Mastyf" width={48} height={48} className="brand-icon" />
        </Link>

        <button
          type="button"
          className="site-nav-toggle"
          aria-expanded={open}
          aria-controls="site-nav-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">Toggle navigation menu</span>
          <span aria-hidden>{open ? '✕' : '☰'}</span>
        </button>

        <nav
          id="site-nav-menu"
          className={`site-nav-links${open ? ' site-nav-links-open' : ''}`}
          aria-label="Primary"
        >
          <div className="site-nav-tab-group">
            {NAV_TABS.map((tab) => {
              const isActive = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`site-nav-item ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {tab.label}
                  {isActive && <span className="site-nav-active-pill" />}
                </Link>
              );
            })}
          </div>

          <div className="site-nav-actions">
            <a
              href={GITHUB_REPO_URL}
              rel="noopener noreferrer"
              target="_blank"
              className="site-nav-github-btn"
              aria-label="View Mastyf on GitHub"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <span>GitHub</span>
            </a>

            <Link href="/download" className="btn btn-primary btn-sm btn-pill font-bold shadow-sm shadow-amber-500/20">
              Download Shield
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

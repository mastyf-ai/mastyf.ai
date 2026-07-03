'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { SUPPORT_MAILTO } from '@/lib/support';

type Props = {
  session: boolean;
};

export function SiteNav({ session }: Props) {
  const pathname = usePathname();
  const isHome = pathname === '/';
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const contactHref = isHome ? '/#contact' : SUPPORT_MAILTO;

  return (
    <header className={`site-nav site-nav-premium${scrolled ? ' site-nav-scrolled' : ''}`}>
      <div className="site-nav-inner">
        <Link href="/" className="brand">
          <Image
            src="/logo-wordmark.png"
            alt="mastyf.ai"
            width={280}
            height={64}
            className="brand-wordmark"
            priority
          />
          <Image src="/logo.png" alt="mastyf.ai" width={56} height={56} className="brand-icon" />
        </Link>

        <button
          type="button"
          className="site-nav-toggle"
          aria-expanded={open}
          aria-controls="site-nav-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          <span aria-hidden>{open ? '✕' : '☰'}</span>
        </button>

        <nav
          id="site-nav-menu"
          className={`site-nav-links${open ? ' site-nav-links-open' : ''}`}
          aria-label="Primary"
        >
          {isHome ? (
            <>
              <a href="#product">Product</a>
              <Link href="/certified">Trust scores</Link>
              <a href="#why">Why mastyf</a>
              <a href="#architecture">Architecture</a>
              <a href="#trust">Trust</a>
            </>
          ) : (
            <>
              <Link href="/">Home</Link>
              <Link href="/certified">Trust scores</Link>
              <Link href="/dashboard">Console</Link>
            </>
          )}
          <a href={contactHref}>Contact</a>
          <a href={GITHUB_REPO_URL} rel="noopener noreferrer" className="site-nav-github">
            GitHub
          </a>
          {session ? (
            <Link href="/dashboard" className="site-nav-cta">
              Dashboard
            </Link>
          ) : (
            <Link href="/login" className="site-nav-cta">
              Sign in free
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

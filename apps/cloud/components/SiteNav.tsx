'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ArrowUpRight, Download, Menu, X } from 'lucide-react';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { Flip } from '@/components/ui/Flip';
import { ThemeToggle } from '@/components/shell/ThemeToggle';

type Props = {
  session: boolean;
};

const NAV_LINKS = [
  { href: '/platform', label: 'Platform' },
  { href: '/docs', label: 'Docs' },
  { href: '/certified', label: 'Certified' },
  { href: '/research', label: 'Research' },
  { href: '/attack-lab', label: 'Attack Lab' },
  { href: '/pricing', label: 'Pricing' },
];

/** Diameter of the collapsed badge; matches `--nav-badge` in shell.css. */
const BADGE = 64;
const MARK = 26;
/** Below this the bar is always open. */
const TOP_ZONE = 40;
/** After the face is clicked, scrolling this far rolls the bar up again. */
const PIN_SLACK = 80;

/** GitHub's mark; lucide no longer ships brand icons. */
function GitHubMark() {
  return (
    <svg className="nav__gh-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteNav({ session }: Props) {
  // Signing in for the first time creates the account, so one entry point covers sign-up too.
  const account = session ? { href: '/dashboard', label: 'Dashboard' } : { href: '/login', label: 'Sign in' };

  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const rowRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLAnchorElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const faceRef = useRef<HTMLButtonElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<(viaKeyboard: boolean) => void>(() => {});

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Scrolling rolls the bar up into the logo badge, which then travels along a track from
  // left to right as the page is read, turning like a wheel. Clicking the badge unrolls the
  // bar until the reader scrolls on again.
  useEffect(() => {
    const row = rowRef.current;
    const bar = barRef.current;
    const inner = innerRef.current;
    const mark = markRef.current;
    const face = faceRef.current;
    const progress = progressRef.current;
    if (!row || !bar || !inner || !mark || !face || !progress) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fadeItems = () =>
      Array.from(inner.querySelectorAll<HTMLElement>('[data-roll]')).filter((el) => el.offsetParent !== null);

    let state: 'open' | 'collapsed' = 'open';
    let pinned = false;
    let pinY = 0;
    let tl: gsap.core.Timeline | null = null;
    // The bar's resting box, read from CSS while it is unrolled.
    let rest = { height: 50, padL: 20, padR: 8, border: 2 };

    const measureRest = () => {
      if (bar.style.width) return;
      const cs = getComputedStyle(bar);
      rest = {
        height: parseFloat(cs.height),
        padL: parseFloat(cs.paddingLeft),
        padR: parseFloat(cs.paddingRight),
        border: parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth),
      };
    };
    const freezeInner = () => {
      gsap.set(inner, { width: row.clientWidth - rest.padL - rest.padR - rest.border });
    };

    // `roll.k` blends the badge from the open bar's left edge (0) to its place on the
    // track (1); `p` is how far down the page the reader is.
    const roll = { k: 0 };
    let p = 0;
    let rowW = row.clientWidth;
    let lastX = -1;
    const place = () => {
      const x = roll.k * p * (rowW - BADGE);
      if (x === lastX) return;
      lastX = x;
      row.style.setProperty('--badge-x', `${x.toFixed(2)}px`);
      progress.style.setProperty('--p', (roll.k * p).toFixed(4));
      if (reduced) return;
      // The logo turns like a wheel rolling along the track: one full turn per circumference travelled.
      face.style.setProperty('--spin', `${((x / (Math.PI * BADGE)) * 360).toFixed(1)}deg`);
    };
    gsap.ticker.add(place);

    gsap.set(face, { autoAlpha: 0, scale: 0.5, rotate: 24 });
    gsap.set(progress, { autoAlpha: 0, clipPath: 'inset(0% 100% 0% 0% round 999px)' });

    const collapse = (instant = false) => {
      if (state === 'collapsed') return;
      state = 'collapsed';
      setCollapsed(true);
      setOpen(false);
      tl?.kill();
      measureRest();
      freezeInner();
      bar.classList.add('is-rolled');
      inner.inert = true;
      const items = fadeItems().reverse();
      tl = gsap
        .timeline({ defaults: { ease: 'power3.inOut' } })
        .to(items, { autoAlpha: 0, x: -14, duration: 0.24, stagger: 0.04, ease: 'power2.in' }, 0)
        .to(
          bar,
          {
            width: BADGE,
            height: BADGE,
            paddingLeft: (BADGE - MARK - rest.border) / 2,
            paddingRight: 0,
            duration: 0.62,
          },
          0.06,
        )
        // The bar winds into the logo, which rolls along to its place on the track.
        .to(roll, { k: 1, duration: 0.62 }, 0.06)
        .to(mark, { rotate: 360, duration: 0.62 }, 0.06)
        .to(mark, { autoAlpha: 0, scale: 0.6, duration: 0.18, ease: 'power2.in' }, 0.52)
        .to(face, { autoAlpha: 1, scale: 1, rotate: 0, duration: 0.5, ease: 'back.out(1.6)' }, 0.54)
        .to(
          progress,
          { autoAlpha: 1, clipPath: 'inset(0% 0% 0% 0% round 999px)', duration: 0.7, ease: 'power3.out' },
          0.64,
        );
      if (instant || reduced) tl.progress(1);
    };

    const expand = (instant = false) => {
      if (state === 'open') return;
      state = 'open';
      setCollapsed(false);
      tl?.kill();
      inner.inert = false;
      freezeInner();
      const items = fadeItems();
      tl = gsap
        .timeline({
          defaults: { ease: 'power3.inOut' },
          onComplete: () => {
            gsap.set([bar, inner, mark, ...items], { clearProps: 'all' });
            bar.classList.remove('is-rolled');
          },
        })
        .to(progress, { autoAlpha: 0, clipPath: 'inset(0% 100% 0% 0% round 999px)', duration: 0.3, ease: 'power2.in' }, 0)
        .to(face, { autoAlpha: 0, scale: 0.5, rotate: 24, duration: 0.24, ease: 'power2.in' }, 0)
        .to(mark, { autoAlpha: 1, scale: 1, duration: 0.2, ease: 'power2.out' }, 0.14)
        .to(mark, { rotate: 0, duration: 0.62 }, 0.14)
        // Both edges unroll outward from wherever the badge was.
        .to(roll, { k: 0, duration: 0.62 }, 0.14)
        .to(
          bar,
          {
            width: row.clientWidth,
            height: rest.height,
            paddingLeft: rest.padL,
            paddingRight: rest.padR,
            duration: 0.62,
          },
          0.14,
        )
        .to(items, { autoAlpha: 1, x: 0, duration: 0.3, stagger: 0.04, ease: 'power2.out' }, 0.34);
      if (instant || reduced) tl.progress(1);
    };

    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 8);

      const max = document.documentElement.scrollHeight - window.innerHeight;
      p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;

      if (y < TOP_ZONE) {
        pinned = false;
        expand();
      } else if (pinned) {
        if (Math.abs(y - pinY) > PIN_SLACK) {
          pinned = false;
          collapse();
        }
      } else {
        collapse();
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    expandRef.current = (viaKeyboard) => {
      pinned = true;
      pinY = window.scrollY;
      expand();
      if (viaKeyboard) brandRef.current?.focus({ preventScroll: true });
    };

    const onResize = () => {
      rowW = row.clientWidth;
      if (state === 'collapsed') freezeInner();
      schedule();
    };

    // A page opened mid-scroll starts rolled up, without the animation.
    if (window.scrollY >= TOP_ZONE) collapse(true);
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', onResize);
      tl?.kill();
      gsap.ticker.remove(place);
      inner.inert = false;
      gsap.set([bar, inner, mark, face, progress, ...fadeItems()], { clearProps: 'all' });
      row.style.removeProperty('--badge-x');
      bar.classList.remove('is-rolled');
    };
  }, []);

  return (
    <>
      <header
        className={`nav${scrolled ? ' is-scrolled' : ''}${open ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`}
      >
        <div className="nav__row" ref={rowRef}>
          <div className="nav__bar" ref={barRef}>
            <div className="nav__inner" ref={innerRef}>
              <Link href="/" className="nav__brand" aria-label="Mastyf home" ref={brandRef}>
                <span className="nav__mark" ref={markRef}>
                  <Image src="/brand/mark-64.png" alt="" width={MARK} height={MARK} priority className="brand-mark" />
                </span>
                <span className="nav__wordmark" data-roll>
                  mastyf.ai
                </span>
              </Link>

              <nav className="nav__links" aria-label="Primary">
                {NAV_LINKS.map((link) => {
                  const active = isActive(pathname, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`nav__link${active ? ' is-active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                      data-magnetic
                      data-roll
                    >
                      <Flip light="var(--accent)">{link.label}</Flip>
                    </Link>
                  );
                })}
              </nav>

              <div className="nav__actions">
                <span className="nav__theme" data-roll>
                  <ThemeToggle />
                </span>
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nav__link nav__external"
                  aria-label="GitHub (opens in a new tab)"
                  data-magnetic
                  data-roll
                >
                  <GitHubMark />
                  <span className="nav__external-label">
                    <Flip light="var(--accent)">GitHub</Flip>
                  </span>
                  <ArrowUpRight className="nav__external-arrow" size={13} strokeWidth={1.75} aria-hidden="true" />
                </a>
                <Link
                  href={account.href}
                  className={`nav__link nav__account${isActive(pathname, account.href) ? ' is-active' : ''}`}
                  data-magnetic
                  data-roll
                >
                  <Flip light="var(--accent)">{account.label}</Flip>
                </Link>
                <Link href="/download" className="btn btn-primary btn-sm nav__cta" data-magnetic data-roll>
                  <Download size={13} strokeWidth={2} aria-hidden="true" />
                  <span className="nav__cta-full">
                    <Flip>Download Shield</Flip>
                  </span>
                  <span className="nav__cta-short">Download</span>
                </Link>
                <button
                  type="button"
                  className="icon-btn nav__toggle"
                  aria-expanded={open}
                  aria-controls="nav-sheet"
                  aria-label={open ? 'Close menu' : 'Open menu'}
                  onClick={() => setOpen((value) => !value)}
                  data-roll
                >
                  {open ? <X size={18} strokeWidth={1.75} /> : <Menu size={18} strokeWidth={1.75} />}
                </button>
              </div>
            </div>
          </div>

          {/* The wrapper travels along the track; GSAP animates the button inside it. */}
          <div className="nav__badge">
            <button
              type="button"
              className="nav__face"
              ref={faceRef}
              aria-label="Show navigation"
              tabIndex={collapsed ? 0 : -1}
              // A keyboard press reports detail 0; focus then moves into the unrolled bar.
              onClick={(event) => expandRef.current(event.detail === 0)}
            >
              <Image src="/brand/mark-128.png" alt="" width={34} height={34} className="nav__face-mark brand-mark" />
            </button>
          </div>

          <div className="nav__progress" ref={progressRef} aria-hidden="true">
            <span className="nav__progress-track">
              <span className="nav__progress-fill" />
            </span>
          </div>
        </div>

        <div id="nav-sheet" className="nav__sheet" hidden={!open} data-lenis-prevent>
          <nav aria-label="Primary mobile">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`nav__sheet-link${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
            {/* The bar has no room for it on narrow screens. */}
            <Link
              href={account.href}
              className={`nav__sheet-link${isActive(pathname, account.href) ? ' is-active' : ''}`}
            >
              {account.label}
            </Link>
          </nav>
          {/* On narrow screens the theme switch lives here instead of in the bar. */}
          <div className="nav__sheet-theme">
            <span>Theme</span>
            <ThemeToggle />
          </div>
          <Link href="/download" className="btn btn-primary btn-lg nav__sheet-cta">
            <Download size={15} strokeWidth={2} aria-hidden="true" />
            Download Shield
          </Link>
        </div>
      </header>
      <div className="nav-spacer" aria-hidden="true" />
    </>
  );
}

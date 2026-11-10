'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowUpRight,
  Award,
  Flame,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  Server,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { signOutAction } from '@/app/actions';
import { ThemeToggle } from '@/components/shell/ThemeToggle';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/policy', label: 'Policy', icon: ShieldCheck },
  { href: '/dashboard/fleet', label: 'Fleet', icon: Server },
  { href: '/dashboard/teams', label: 'Teams', icon: Users },
  { href: '/dashboard/threat-feed', label: 'Threat feed', icon: Flame },
  { href: '/dashboard/trust-scores', label: 'Trust scores', icon: Award },
  { href: '/dashboard/license', label: 'License', icon: KeyRound },
  { href: '/dashboard/account', label: 'Account', icon: UserRound },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  { href: '/dashboard/connect', label: 'Link a proxy', icon: Link2 },
];

function isCurrent(pathname: string, href: string) {
  return href === '/dashboard' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

type Props = {
  orgName?: string;
  orgSlug?: string;
  email?: string | null;
};

/** The dashboard sidebar (a top bar on narrow screens). */
export function DashboardNav({ orgName, orgSlug, email }: Props) {
  const pathname = usePathname();

  return (
    <aside className="app__side">
      <Link href="/dashboard" className="app__brand">
        <Image src="/brand/mark-64.png" alt="" width={24} height={24} className="brand-mark" />
        <span>
          mastyf.ai <small>Cloud</small>
        </span>
      </Link>

      <div className="app__org" title={orgName}>
        <strong>{orgName || 'Your organization'}</strong>
        {orgSlug ? <span>{orgSlug}</span> : null}
      </div>

      <nav className="app__nav" aria-label="Dashboard">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? 'page' : undefined}>
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="app__foot">
        <div className="app__row">
          <span className="app__email" title={email ?? undefined}>
            {email}
          </span>
          <ThemeToggle />
          <form action={signOutAction}>
            <button type="submit" className="icon-btn" aria-label="Sign out" title="Sign out">
              <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </form>
        </div>
        <div className="app__row app__site">
          <Link href="/" className="link-icon">
            Back to mastyf.ai
            <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </aside>
  );
}

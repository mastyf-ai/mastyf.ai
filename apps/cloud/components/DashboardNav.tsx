import Link from 'next/link';
import { CLOUD_NAME } from '@/lib/product-links';

const links = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/policy', label: 'Policy' },
  { href: '/dashboard/fleet', label: 'Fleet' },
  { href: '/dashboard/teams', label: 'Teams' },
  { href: '/dashboard/threat-feed', label: 'Threat Feed' },
  { href: '/dashboard/trust-scores', label: 'Trust Scores' },
  { href: '/dashboard/license', label: 'License' },
  { href: '/dashboard/settings', label: 'Settings' },
  { href: '/dashboard/connect', label: 'Link proxy' },
];

export function DashboardNav() {
  return (
    <nav className="dashboard-nav">
      <div className="brand">
        <Link href="/dashboard">{CLOUD_NAME}</Link>
      </div>
      <div className="nav-links">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

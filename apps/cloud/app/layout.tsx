import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SessionProvider } from '@/components/SessionProvider';
import { PRODUCTION_SITE_URL, SITE_NAME } from '@/lib/product-links';
import { isAuthConfigured } from '@/lib/safe-auth';
import { resolveSiteUrl } from '@/lib/site-url';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const siteUrl = resolveSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl || PRODUCTION_SITE_URL),
  title: `${SITE_NAME} — Perimeter security for your AI`,
  description:
    `${SITE_NAME} intercepts every MCP tool call, enforces security policy, blocks violations before execution, and scores npm packages. Runtime proxy, ops dashboard, and free cloud console.`,
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    title: `${SITE_NAME} — Know which MCP servers are safe to trust`,
    description:
      'Look up any npm MCP package for an instant 0–100 trust score. Free cloud console for policy and fleet management.',
    images: ['/assets/security-swarm-architecture.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const authEnabled = isAuthConfigured();
  const content = authEnabled ? <SessionProvider>{children}</SessionProvider> : children;

  return (
    <html lang="en" className={inter.variable}>
      <body>
        {content}
        <Analytics />
      </body>
    </html>
  );
}

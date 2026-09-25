import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono, Instrument_Serif } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SessionProvider } from '@/components/SessionProvider';
import { PRODUCTION_SITE_URL, SITE_NAME } from '@/lib/product-links';
import { isAuthConfigured } from '@/lib/safe-auth';
import { resolveSiteUrl } from '@/lib/site-url';
import './globals.css';

const fontSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  weight: ['400', '500', '600', '700', '800'],
});

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  weight: ['400', '500', '600', '700'],
});

const fontSerif = Instrument_Serif({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-serif',
  weight: ['400'],
});

const siteUrl = resolveSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl || PRODUCTION_SITE_URL),
  title: 'Mastyf — AI Agent Security Platform | Control What AI Agents Can Execute',
  description:
    'Your AI can reason. Mastyf controls what it can execute. An externally enforced security layer for AI agent tool execution, combining runtime authorization, adversarial testing, MCP trust, and centralized enterprise fleet governance.',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    title: 'Mastyf — AI Agent Security Platform',
    description:
      'The model is not the security boundary. The agent proposes. Mastyf authorizes. Infrastructure executes.',
    images: ['/logo.png'],
  },
  twitter: {
    card: 'summary',
    images: ['/logo.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const authEnabled = isAuthConfigured();
  const content = authEnabled ? <SessionProvider>{children}</SessionProvider> : children;

  return (
    <html lang="en" className={`${fontSans.variable} ${fontMono.variable} ${fontSerif.variable}`}>
      <body>
        {content}
        <Analytics />
      </body>
    </html>
  );
}

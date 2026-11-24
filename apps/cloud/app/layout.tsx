import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Analytics } from '@vercel/analytics/next';
import { SessionProvider } from '@/components/SessionProvider';
import { CustomCursor } from '@/components/shell/CustomCursor';
import { RevealManager } from '@/components/shell/RevealManager';
import { SmoothScroll } from '@/components/shell/SmoothScroll';
import { PRODUCTION_SITE_URL, SITE_NAME } from '@/lib/product-links';
import { isAuthConfigured } from '@/lib/safe-auth';
import { resolveSiteUrl } from '@/lib/site-url';
import './globals.css';

// Fonts ship with the app (app/fonts, SIL Open Font License) instead of being downloaded from
// Google Fonts at build time, so a Google Fonts hiccup can no longer fail a deploy.
const fontDisplay = localFont({
  src: [{ path: './fonts/bricolage-grotesque-latin.woff2', weight: '600 800', style: 'normal' }],
  display: 'swap',
  variable: '--font-bricolage',
});

const fontUi = localFont({
  src: [{ path: './fonts/ibm-plex-sans-latin.woff2', weight: '400 600', style: 'normal' }],
  display: 'swap',
  variable: '--font-ui',
});

const fontMono = localFont({
  src: [
    { path: './fonts/ibm-plex-mono-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-mono-500.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-mono',
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

const HEAD_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem('mastyf-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';d.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','dark')}
try{var d=document.documentElement,p=location.pathname==='/',r=matchMedia('(prefers-reduced-motion: reduce)').matches;d.setAttribute('data-intro',p&&!r?'play':'skip')}catch(e){document.documentElement.setAttribute('data-intro','skip')}`;

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f2ec' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const authEnabled = isAuthConfigured();
  const content = authEnabled ? <SessionProvider>{children}</SessionProvider> : children;

  return (
    <html
      lang="en"
      className={`${fontDisplay.variable} ${fontUi.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs while the HTML is parsed, before first paint (next/script's beforeInteractive
            waits for the JS bundle, which flashes the default theme first):
            the theme is the saved choice, else the system setting; the home intro plays
            on every load of the home page, never with reduced motion. */}
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT }} />
      </head>
      <body>
        <SmoothScroll />
        <RevealManager />
        {content}
        <CustomCursor />
        <Analytics />
      </body>
    </html>
  );
}

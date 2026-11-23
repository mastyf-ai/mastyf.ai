import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { IBM_Plex_Mono, Poppins } from 'next/font/google';
import './design/tokens.css';
import './design/enterprise.css';
import './design/components.css';
import './design/utilities.css';
import './design/brand.css';
import './design/motion.css';

// Fonts are downloaded at build time and served from this dashboard, so it works offline and
// makes no third-party requests when it loads.
// Poppins is the Mastyf Shield app's typeface; Plex Mono is kept for tool calls and code.
const sans = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Mastyf',
  applicationName: 'mastyf.ai',
  description: 'Every tool call your AI agents make, checked against your policy before it runs.',
  icons: { icon: '/dashboard-spa/logo.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0a0b',
};

/** Dark (Shield) is the default; a saved choice from the header toggle wins. Runs before paint. */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('mastyf-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Script id="mastyf-theme" strategy="beforeInteractive">{THEME_BOOT}</Script>
        {children}
      </body>
    </html>
  );
}

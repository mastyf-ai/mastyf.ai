import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { SessionProvider } from '@/components/SessionProvider';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://mcp-guardian-cloud.vercel.app'),
  title: 'MCP Guardian — Runtime security for MCP',
  description:
    'CI-gated Security Swarm, three-layer detection, and optional cloud control plane. 154/154 corpus blocked, enterprise-ready proxy for Cursor, Cline, and Claude Code.',
  openGraph: {
    title: 'MCP Guardian',
    description: 'Runtime security, cost governance, and Security Swarm for Model Context Protocol infrastructure.',
    images: ['/assets/security-swarm-architecture.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
        <Analytics />
      </body>
    </html>
  );
}

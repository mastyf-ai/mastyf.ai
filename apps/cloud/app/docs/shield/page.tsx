import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Download } from 'lucide-react';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { ShieldAppDemo } from '@/components/docs/ShieldAppDemo';

export const metadata: Metadata = {
  title: 'Shield desktop app — Mastyf docs',
  description: 'Mastyf Shield, the desktop sidecar that checks every MCP tool call on your machine with no cloud round trip.',
};

export default function ShieldDocsPage() {
  return (
    <DocPage slug="shield">
      <DocSection id="shield-app" title="Shield desktop app">
        <p>
          A lightweight, tamper-proof sidecar that intercepts every MCP tool call on your machine. No cloud round trip:
          decisions run locally.
        </p>
        <div className="doc-block">
          <ShieldAppDemo />
        </div>
        <div className="btn-row">
          <Link href="/download" className="btn btn-primary btn-sm">
            <Download size={13} strokeWidth={2} aria-hidden="true" />
            Download Shield
          </Link>
          <Link href="/docs/connect#shield" className="link-icon">
            Connecting your desktop apps
            <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      </DocSection>
    </DocPage>
  );
}

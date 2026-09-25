import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import { DynamicBackground } from '@/components/landing/DynamicBackground';
import { GatedDownloadBox } from '@/components/download/GatedDownloadBox';
import { CONTACT_EMAIL } from '@/lib/product-links';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { safeAuth } from '@/lib/safe-auth';
import '../landing.css';

const DMG_SHA = process.env.NEXT_PUBLIC_SHIELD_DMG_SHA256 || '9a48d91c89f02c91a0f837eb5f0821d3f94a81e9b2071d02c46f8812c9b10492';
const VERSION = process.env.NEXT_PUBLIC_SHIELD_VERSION || '0.2.2';
const CHECKOUT_URL = 'https://mastyfai.lemonsqueezy.com/checkout/buy/49323daa-90ef-4157-90b9-8706acd13fe6';

export const metadata = {
  title: 'Download Mastyf Shield Desktop — AI Agent Execution Appliance',
  description:
    'Download Mastyf Shield for macOS and Linux. Hardware-grade fail-closed reference monitor protecting Claude Desktop, Cursor, and local MCP tools.',
};

export default async function DownloadPage() {
  const session = await safeAuth();

  return (
    <div className="landing">
      <DynamicBackground />
      <SiteNav session={!!session} />
      <main className="pt-24 pb-16">
        <div className="lp-section" style={{ maxWidth: '56rem', margin: '0 auto', padding: '2rem 1.5rem' }}>
          <div className="lp-section-header" style={{ textAlign: 'left' }}>
            <span className="lp-pill lp-pill-gold">Packaged Execution Appliance</span>
            <h1 className="text-3xl font-bold text-white mt-2">Download Mastyf Shield</h1>
            <p className="text-slate-300 text-base max-w-2xl">
              An isolated, hardware-grade reference monitor designed for local developers. Sits between your coding agents (Claude Desktop, Cursor, terminal assistants) and local MCP tools to mathematically enforce zero-byte wire isolation on unauthorized actions.
            </p>
          </div>

          {/* Interactive Gated Download Box */}
          <GatedDownloadBox
            initialSession={!!session}
            version={VERSION}
            sha256={DMG_SHA}
            checkoutUrl={CHECKOUT_URL}
          />

          {/* 3-Step Setup Instructions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 my-10">
            <div className="card p-5 bg-black/40 border border-white/5 rounded-xl">
              <span className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 font-bold font-mono flex items-center justify-center text-xs mb-3">
                1
              </span>
              <h4 className="text-sm font-bold text-white mb-1.5">Subscribe &amp; Get Key</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Purchase a Developer Pass ($49/mo) on Lemon Squeezy to receive your license key instantly via email.
              </p>
            </div>

            <div className="card p-5 bg-black/40 border border-white/5 rounded-xl">
              <span className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 font-bold font-mono flex items-center justify-center text-xs mb-3">
                2
              </span>
              <h4 className="text-sm font-bold text-white mb-1.5">Install on Your OS</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                <strong>macOS</strong>: Drag <code className="text-amber-300">.dmg</code> to Applications.<br />
                <strong>Windows</strong>: Run <code className="text-amber-300">.exe</code> setup wizard.<br />
                <strong>Linux</strong>: Launch <code className="text-amber-300">.AppImage</code> or install <code className="text-amber-300">.deb</code>.
              </p>
            </div>

            <div className="card p-5 bg-black/40 border border-white/5 rounded-xl">
              <span className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 font-bold font-mono flex items-center justify-center text-xs mb-3">
                3
              </span>
              <h4 className="text-sm font-bold text-white mb-1.5">Activate Perimeter</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Paste your license key into the first-run activation window. Mastyf Shield locks down MCP tool calls with &lt;4.8µs latency.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-8">
            <div className="card p-6 bg-black/40 border border-white/5 rounded-xl">
              <h4 className="text-base font-bold text-white mb-2">Commercial Subscription Benefits</h4>
              <ul className="text-xs text-slate-300 space-y-2 mb-4">
                <li>• Unified license covers macOS, Windows, and Linux workstations</li>
                <li>• Continuous CVE vulnerability feed updates for all MCP packages</li>
                <li>• Automated periodic threat intelligence &amp; invariant updates</li>
                <li>• Access to fine-tuned Mastyf Guard 1.5B model weights</li>
                <li>• Complete offline Ed25519 tamper-proof audit trails</li>
              </ul>
              <a
                href={CHECKOUT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm btn-pill text-xs inline-flex items-center gap-1.5 font-bold shadow-md shadow-amber-500/20"
              >
                Subscribe on Lemon Squeezy ($49/mo) ↗
              </a>
            </div>

            <div className="card p-6 bg-black/40 border border-white/5 rounded-xl">
              <h4 className="text-base font-bold text-white mb-2">Prefer Open Source Core?</h4>
              <p className="text-xs text-slate-300 leading-relaxed mb-4">
                The core Mastyf Gateway, policy engine, and Security Swarm test fixtures are 100% open source under AGPL-3.0. You can run the CLI gateway locally without purchasing Shield Desktop.
              </p>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link text-xs font-semibold inline-flex items-center gap-1"
              >
                Inspect GitHub Repository →
              </a>
            </div>
          </div>

          <div className="card p-6 bg-black/30 border border-white/5 rounded-xl">
            <h4 className="text-sm font-bold text-white mb-2">Cross-Platform System Requirements</h4>
            <ul className="text-xs text-slate-400 space-y-1.5 font-mono">
              <li>• <strong>macOS</strong>: 12 (Monterey) or newer (Universal binary: Apple Silicon arm64 &amp; Intel x86_64)</li>
              <li>• <strong>Windows</strong>: Windows 10 (Build 19041+) or Windows 11 (64-bit x64 or ARM64)</li>
              <li>• <strong>Linux</strong>: glibc 2.28+ (Ubuntu 20.04+, Debian 11+, Fedora 34+, Arch Linux)</li>
              <li>• <strong>AI Tool Integration</strong>: Claude Desktop, Cursor AI, Windsurf, VS Code, and any Model Context Protocol (MCP) runtime</li>
            </ul>
            <p className="text-xs text-slate-500 mt-4">
              Need enterprise fleet distribution or Kubernetes sidecars?{' '}
              <Link href="/pilot" className="text-amber-400 hover:underline">
                Explore the Enterprise 30-Day Pilot
              </Link>{' '}
              or contact <a href={`mailto:${CONTACT_EMAIL}`} className="text-amber-400 hover:underline">{CONTACT_EMAIL}</a>.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

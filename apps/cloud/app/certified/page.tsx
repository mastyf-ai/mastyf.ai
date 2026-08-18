import Link from 'next/link';
import { resolveCloudBaseUrl } from '@/lib/trust-badge-svg';
import { BadgeLookupWidget } from '@/components/BadgeLookupWidget';
import { PackageGrid } from './package-grid';
import './certified.css';
import './socket-certified.css';
import './enhanced-card.css';

export const dynamic = 'force-dynamic';

export default function CertifiedDirectoryPage() {
  const cloudBase = resolveCloudBaseUrl();

  return (
    <div className="certified-directory">
      <section className="certified-hero">
        <p className="certified-hero-eyebrow">Trust scores</p>
        <h1>
          Instant security scores for <span>any npm MCP package</span>
        </h1>
        <p className="certified-hero-lead">
          CVE posture, supply-chain signals, and plain-English guidance. Optional deep scan probes
          the live MCP server.{' '}
          <Link href="/tutorials/site-walkthrough">Watch walkthrough →</Link>
        </p>
        <div className="certified-lookup-card card-elevated">
          <BadgeLookupWidget variant="hero" />
        </div>
      </section>

      <div className="certified-steps">
        <div className="certified-step-card card-elevated">
          <strong>1 · Look up</strong>
          <span>Type an npm package name (e.g. @playwright/mcp). Static analysis runs automatically.</span>
        </div>
        <div className="certified-step-card card-elevated">
          <strong>2 · Deep scan</strong>
          <span>Optionally probe the live MCP server for a richer score with runtime signals.</span>
        </div>
        <div className="certified-step-card card-elevated">
          <strong>3 · Embed</strong>
          <span>Copy badge markdown from the score page into your README.</span>
        </div>
      </div>

      <section className="certified-recent">
        <PackageGrid />
      </section>

      <p className="certified-foot">
        Badge API: <code>{cloudBase}/api/v1/badge/&lt;package&gt;</code>
      </p>
    </div>
  );
}

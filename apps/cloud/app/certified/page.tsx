import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { resolveCloudBaseUrl } from '@/lib/trust-badge-svg';
import { BadgeLookupWidget } from '@/components/BadgeLookupWidget';
import { PackageGrid } from './package-grid';
import './certified.css';
import './socket-certified.css';
import './enhanced-card.css';

export const dynamic = 'force-dynamic';

const STEPS = [
  { title: 'Look up', body: 'Type an npm package name. Static analysis runs right away.' },
  { title: 'Deep scan', body: 'Optionally probe the live MCP server for runtime signals and a richer score.' },
  { title: 'Embed', body: 'Copy the badge markdown from the score page into your README.' },
] as const;

export default function CertifiedDirectoryPage() {
  const cloudBase = resolveCloudBaseUrl();

  return (
    <main className="page-main">
      <header className="page-head certified-head">
        <div>
          <h1 className="page-head__title">Check an MCP server before your agent installs it</h1>
          <p className="page-head__lead">
            Mastyf Trust scores npm MCP packages on known vulnerabilities, supply-chain signals, and how the server
            behaves when probed. Free and public.
          </p>
          <Link href="/tutorials/site-walkthrough" className="link-icon">
            Watch the walkthrough
            <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
        <div className="certified-lookup">
          <BadgeLookupWidget variant="hero" />
        </div>
      </header>

      <section className="section section--flush-top certified-body" aria-label="Scored packages">
        <ol className="step-row certified-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="step-row__n">{i + 1}</span>
              <span>
                <strong>{step.title}</strong>
                {step.body}
              </span>
            </li>
          ))}
        </ol>

        <div className="certified-recent">
          <PackageGrid />
        </div>

        <p className="certified-foot">
          Badge API: <code>{cloudBase}/api/v1/badge/&lt;package&gt;</code>
        </p>
      </section>
    </main>
  );
}

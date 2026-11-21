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
    <main className="page-main">
      <header className="page-head certified-head">
        <div>
          <h1 className="page-head__title">Check an MCP server before your agent installs it</h1>
          <p className="page-head__lead">
            Mastyf Trust scores npm MCP packages on known vulnerabilities, supply-chain signals, and how the server
            behaves when probed. Free and public.
          </p>
        </div>
        <div className="certified-lookup">
          <BadgeLookupWidget variant="hero" />
        </div>
      </header>

      <section className="section section--flush-top certified-body" aria-label="Scored packages">
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

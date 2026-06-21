import Link from 'next/link';
import Image from 'next/image';
import { listRecentPackageScores } from '@/lib/package-score-resolver';
import { computeTrustGrade, trustGradeColor } from '@/lib/trust-badge-grade';
import { resolveCloudBaseUrl } from '@/lib/trust-badge-svg';
import { BadgeLookupWidget } from '@/components/BadgeLookupWidget';
import './certified.css';
import './socket-certified.css';

export const dynamic = 'force-dynamic';

export default async function CertifiedDirectoryPage() {
  const cloudBase = resolveCloudBaseUrl();
  let scores: Awaited<ReturnType<typeof listRecentPackageScores>> = [];
  let error: string | null = null;
  try {
    scores = await listRecentPackageScores(200);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : 'Failed to load scores';
  }

  return (
    <>
      <section className="socket-hero">
        <h1 className="socket-hero-brand">
          <Image src="/logo.jpeg" alt="" width={44} height={44} className="socket-brand-logo" />
          <span>
            mastyf.ai <span className="socket-hero-brand-sub">security score</span>
          </span>
        </h1>
        <p className="socket-hero-lead">
          Enter any npm MCP package name for an instant security score — CVE posture, supply chain
          signals, and plain-English guidance. Optional deep scan probes the live MCP server.{' '}
          <Link href="/tutorials/site-walkthrough">Watch walkthrough video →</Link>
        </p>
        <BadgeLookupWidget variant="hero" />
      </section>

      <div className="socket-steps">
        <div className="socket-step-card">
          <strong>1 · Look up</strong>
          <span>Type an npm package name (e.g. @playwright/mcp). Static analysis runs automatically.</span>
        </div>
        <div className="socket-step-card">
          <strong>2 · Deep scan</strong>
          <span>Optionally start the MCP server and probe tools for a richer live score (local dev).</span>
        </div>
        <div className="socket-step-card">
          <strong>3 · Embed</strong>
          <span>Copy badge markdown from the score page into your README.</span>
        </div>
      </div>

      <main className="socket-main">
        <h2 className="socket-section-title" style={{ marginTop: '2.5rem' }}>
          Recently scored packages
        </h2>

        {error ? (
          <p role="alert" className="certified-error">{error}</p>
        ) : scores.length === 0 ? (
          <p className="socket-hero-lead" style={{ textAlign: 'left', margin: '1rem 0' }}>
            No cached scores yet. Look up a package above — scores are computed on demand from npm
            and CVE feeds.
          </p>
        ) : (
          <div className="socket-table-wrap">
            <table className="socket-table">
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Score</th>
                  <th>Grade</th>
                  <th>Level</th>
                  <th>Scan</th>
                  <th>Version</th>
                  <th>Scored</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((c) => {
                  const grade = computeTrustGrade(c.score);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/certified/${encodeURIComponent(c.packageName)}`}>{c.packageName}</Link>
                      </td>
                      <td>
                        <span
                          className="socket-score-pill"
                          style={{ background: trustGradeColor(grade) }}
                        >
                          {c.score}/100
                        </span>
                      </td>
                      <td>{grade}</td>
                      <td style={{ textTransform: 'capitalize' }}>{c.level}</td>
                      <td style={{ textTransform: 'capitalize' }}>{c.scanTier}</td>
                      <td>{c.version}</td>
                      <td>{new Date(c.computedAt).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="certified-foot">
          Badge API: <code>{cloudBase}/api/v1/badge/&lt;package&gt;</code>
        </p>
      </main>
    </>
  );
}

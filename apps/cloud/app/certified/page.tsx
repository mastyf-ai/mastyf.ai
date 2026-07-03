import Link from 'next/link';
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
        <div className="certified-recent-header">
          <h2>Recently scored packages</h2>
          {!error && scores.length > 0 ? (
            <span className="certified-recent-count">{scores.length} packages</span>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="certified-error card-elevated" style={{ padding: '1.25rem' }}>
            {error}
          </p>
        ) : scores.length === 0 ? (
          <p className="certified-hero-lead" style={{ textAlign: 'left' }}>
            No cached scores yet. Look up a package above — scores are computed on demand from npm
            and CVE feeds.
          </p>
        ) : (
          <div className="certified-package-grid">
            {scores.map((c) => {
              const grade = computeTrustGrade(c.score);
              return (
                <Link
                  key={c.id}
                  href={`/certified/${encodeURIComponent(c.packageName)}`}
                  className="certified-package-card card-elevated"
                >
                  <span className="certified-package-name">{c.packageName}</span>
                  <div className="certified-package-meta">
                    <span className="score-chip-cap">{c.level}</span>
                    <span>·</span>
                    <span className="score-chip-cap">{c.scanTier} scan</span>
                    <span>·</span>
                    <span>v{c.version}</span>
                  </div>
                  <div className="certified-package-footer">
                    <span
                      className="socket-score-pill"
                      style={{ background: trustGradeColor(grade) }}
                    >
                      {c.score}/100 · {grade}
                    </span>
                    <span className="certified-recent-count">
                      {new Date(c.computedAt).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <p className="certified-foot">
        Badge API: <code>{cloudBase}/api/v1/badge/&lt;package&gt;</code>
      </p>
    </div>
  );
}

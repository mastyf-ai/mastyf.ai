import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { verifyPublicCertification } from '@/lib/industry-standard';
import {
  InvalidPackageNameError,
  isDeepScanEnabled,
  PackageNotFoundError,
  resolvePackageScore,
} from '@/lib/package-score-resolver';
import { BadgeEmbedGallery } from '@/components/BadgeEmbedGallery';
import { DeepScanButton } from '@/components/DeepScanButton';
import { PackageNotFound } from '@/components/PackageNotFound';
import { ScanTierBadge } from '@/components/ScanTierBadge';
import { ScoreReportPanel } from '@/components/ScoreReportPanel';
import { ScoreRing } from '@/components/ScoreRing';
import { computeTrustGrade } from '@/lib/trust-badge-grade';
import { certificationChecksOnly } from '@/lib/score-report';
import {
  packagePathFromSegments,
  renderTrustBadgeSvg,
  resolveCloudBaseUrl,
} from '@/lib/trust-badge-svg';
import '../certified.css';
import '../socket-certified.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ package: string[] }> };

async function resolveCloudBaseFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'http';
  if (host) return `${proto}://${host}`;
  return resolveCloudBaseUrl();
}

export default async function CertifiedPackagePage({ params }: Props) {
  const segments = (await params).package ?? [];
  const packageName = packagePathFromSegments(segments);
  if (!packageName) notFound();

  const cloudBase = await resolveCloudBaseFromHeaders();

  let score: Awaited<ReturnType<typeof resolvePackageScore>>;
  try {
    score = await resolvePackageScore(packageName);
  } catch (err: unknown) {
    if (err instanceof PackageNotFoundError || err instanceof InvalidPackageNameError) {
      return <PackageNotFound packageName={packageName} />;
    }
    throw err;
  }

  const grade = computeTrustGrade(score.score);
  const scoreReport = score.scoreReport;

  let verification: Awaited<ReturnType<typeof verifyPublicCertification>> | null = null;
  if (score.source === 'attested') {
    try {
      verification = await verifyPublicCertification(score.id);
    } catch {
      verification = null;
    }
  }

  const badgeSvg = renderTrustBadgeSvg({
    score: score.score,
    grade,
    packageName,
    style: 'flat',
  });

  return (
    <main className="score-page">
      <nav className="score-breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden>/</span>
        <Link href="/certified">Security scores</Link>
        <span aria-hidden>/</span>
        <span className="score-breadcrumb-current">{packageName}</span>
      </nav>

      <section className="score-hero card-elevated">
        <div className="score-hero-grid">
          <div className="score-hero-ring">
            <ScoreRing score={score.score} grade={grade} size={168} />
          </div>

          <div className="score-hero-body">
            <p className="score-hero-eyebrow">Package trust score</p>
            <h1 className="score-hero-title">{packageName}</h1>

            <div className="score-meta-chips">
              <span className="score-chip">{score.serverName}</span>
              <span className="score-chip">v{score.version}</span>
              <span className="score-chip score-chip-cap">{score.level}</span>
              <ScanTierBadge tier={score.scanTier} source={score.source} />
            </div>

            <div
              className="score-hero-badge"
              dangerouslySetInnerHTML={{ __html: badgeSvg }}
            />

            <p className="score-hero-summary">{scoreReport.summaryPlainEnglish}</p>

            {verification ? (
              <p className={`score-attestation score-attestation-${verification.valid ? 'valid' : 'invalid'}`}>
                Attestation {verification.valid ? 'valid' : verification.expired ? 'expired' : 'invalid'}
              </p>
            ) : null}

            <DeepScanButton
              packageName={packageName}
              enabled={isDeepScanEnabled()}
              currentTier={score.scanTier}
              source={score.source}
            />
          </div>
        </div>

        <div className="score-stat-row">
          <div className="score-stat-card">
            <span className="score-stat-label">Scored</span>
            <strong>{new Date(score.computedAt).toLocaleString()}</strong>
          </div>
          <div className="score-stat-card">
            <span className="score-stat-label">Cache expires</span>
            <strong>{new Date(score.expiresAt).toLocaleString()}</strong>
          </div>
          <div className="score-stat-card">
            <span className="score-stat-label">Scan tier</span>
            <strong className="score-stat-cap">{score.scanTier}</strong>
          </div>
          <div className="score-stat-card">
            <span className="score-stat-label">Trust level</span>
            <strong className="score-stat-cap">{score.level}</strong>
          </div>
        </div>
      </section>

      <ScoreReportPanel report={scoreReport} />

      <div className="score-page-grid">
        <section className="score-side-card card-elevated">
          <h2 className="score-section-title">Embed badge</h2>
          <p className="score-section-lead">
            Pick a layout and copy markdown, HTML, RST, BBCode, or AsciiDoc for your README.
          </p>
          <BadgeEmbedGallery
            cloudBaseUrl={cloudBase}
            packageName={packageName}
            badgeCacheKey={score.computedAt}
          />
        </section>

        {score.source === 'attested' ? (
          <section className="score-side-card card-elevated">
            <h2 className="score-section-title">Maintainer attestation</h2>
            <p className="score-section-lead">
              This score was published with a signed attestation from a maintainer proxy scan.
            </p>
            <pre className="score-code-block">{`mastyf-ai certify publish \\
  --server ${score.serverName} \\
  --package ${packageName} \\
  --pkg-version ${score.version} \\
  --cloud-url ${cloudBase}`}</pre>
          </section>
        ) : (
          <section className="score-side-card card-elevated">
            <h2 className="score-section-title">Improve this score</h2>
            <p className="score-section-lead">
              Fix the issues above, then run a deep scan or publish from your mastyf.ai proxy for a
              maintainer-verified badge.
            </p>
            {certificationChecksOnly(score.checks).length > 0 ? (
              <ul className="score-check-list">
                {certificationChecksOnly(score.checks).map((c) => (
                  <li key={String(c.id ?? c.name)} className={c.passed ? 'pass' : 'fail'}>
                    <span className="score-check-icon" aria-hidden>{c.passed ? '✓' : '✗'}</span>
                    <div>
                      <strong>{c.name}</strong>
                      <p>{c.details}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="score-section-lead">No additional certification checks to display.</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { verifyPublicCertification } from '@/lib/industry-standard';
import {
  InvalidPackageNameError,
  isDeepScanEnabled,
  PackageNotFoundError,
  resolvePackageScoreWithStale,
} from '@/lib/package-score-resolver';
import { ArrowDown, ArrowLeft } from 'lucide-react';
import { BadgeEmbedGallery } from '@/components/BadgeEmbedGallery';
import { DeepScanButton } from '@/components/DeepScanButton';
import { PackageNotFound } from '@/components/PackageNotFound';
import { ScoreReportPanel } from '@/components/ScoreReportPanel';
import { ScoreRing } from '@/components/ScoreRing';
import { computeTrustGrade } from '@/lib/trust-badge-grade';
import { mergePackageData, formatDownloads } from '@/lib/package-data-merge';
import { packagePathFromSegments, resolveCloudBaseUrl } from '@/lib/trust-badge-svg';
import '../certified.css';
import '../socket-certified.css';
import '../score.css';

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

  let score: Awaited<ReturnType<typeof resolvePackageScoreWithStale>>['score'];
  let isStale = false;
  try {
    const result = await resolvePackageScoreWithStale(packageName);
    score = result.score;
    isStale = result.stale;
  } catch (err: unknown) {
    if (err instanceof PackageNotFoundError || err instanceof InvalidPackageNameError) {
      return <PackageNotFound packageName={packageName} />;
    }
    throw err;
  }

  const grade = computeTrustGrade(score.score);
  const data = mergePackageData(
    score.scoreReport,
    score.checks,
    score.score,
    grade,
    score.level,
    score.version,
  );

  let verification: Awaited<ReturnType<typeof verifyPublicCertification>> | null = null;
  if (score.source === 'attested') {
    try {
      verification = await verifyPublicCertification(score.id);
    } catch {
      verification = null;
    }
  }

  const facts: { label: string; value: string }[] = [];
  if (data.downloads !== undefined) facts.push({ label: 'Downloads a week', value: formatDownloads(data.downloads) });
  if (data.license)
    facts.push({ label: 'License', value: /^see license/i.test(data.license) ? 'Custom, in its files' : data.license });
  if (data.maintainers !== undefined) facts.push({ label: 'Maintainers', value: String(data.maintainers) });
  if (data.packageAgeDays !== undefined) facts.push({ label: 'Age', value: formatAge(data.packageAgeDays) });
  if (data.lastPublishedDays !== undefined)
    facts.push({ label: 'Last update', value: data.lastPublishedDays === 0 ? 'Today' : `${formatAge(data.lastPublishedDays)} ago` });
  if (data.depCount !== undefined) facts.push({ label: 'Dependencies', value: String(data.depCount) });
  facts.push({ label: 'Known vulnerabilities', value: String(data.cves.total) });
  if (data.hasRepo !== undefined) facts.push({ label: 'Public source code', value: data.hasRepo ? 'Yes' : 'No' });

  const checkedOn = new Date(score.computedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const how =
    score.source === 'attested'
      ? 'scanned by its maintainer and signed'
      : score.scanTier === 'live'
        ? 'started and tested live'
        : 'checked from its published package';

  return (
    <main className="score-page pkg">
      <nav className="pkg-back" aria-label="Breadcrumb">
        <Link href="/certified">
          <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
          All security scores
        </Link>
      </nav>

      <section className="pkg-hero" aria-labelledby="pkg-title">
        <div className="pkg-hero__body">
          <h1 id="pkg-title" className="pkg-hero__title">
            {packageName}
          </h1>
          {data.description ? <p className="pkg-hero__desc">{data.description}</p> : null}
          {/* The ring already shows the score and grade, so the summary starts after them. */}
          <p className="pkg-hero__summary">{data.summary.replace(/^Overall score:[^.]*\.\s*/i, '')}</p>
          <p className="pkg-hero__meta">
            Version {score.version}, {how} on {checkedOn}.
            {verification
              ? verification.valid
                ? ' The maintainer’s signature checks out.'
                : verification.expired
                  ? ' The maintainer’s signature has expired.'
                  : ' The maintainer’s signature does not check out.'
              : null}
            {isStale ? ' This score may be out of date.' : null}
          </p>
          <div className="pkg-hero__actions">
            <DeepScanButton
              packageName={packageName}
              enabled={isDeepScanEnabled()}
              currentTier={score.scanTier}
              source={score.source}
            />
            <a href="#badge" className="link-icon">
              Get the badge
              <ArrowDown size={13} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="pkg-hero__score">
          <ScoreRing score={score.score} grade={grade} />
          <p className="pkg-hero__grade">
            Grade {grade}, <span className="pkg-cap">{score.level}</span> level
          </p>
        </div>
      </section>

      <dl className="pkg-facts">
        {facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>

      <ScoreReportPanel
        report={{
          overallScore: data.score,
          grade: data.grade,
          summaryPlainEnglish: data.summary,
          categories: data.categories,
          improvementActions: data.improvementActions,
          issues: data.issues,
        }}
        probe={data.probe ?? undefined}
      />

      {score.source === 'attested' ? (
        <section className="pkg-section" aria-labelledby="pkg-attest">
          <h2 id="pkg-attest">Published by the maintainer</h2>
          <p>The maintainer scanned this server and published the result with a signature, using:</p>
          <pre className="pkg-code">{`mastyf-ai certify publish \
  --server ${score.serverName} \
  --package ${packageName} \
  --pkg-version ${score.version} \
  --cloud-url ${cloudBase}`}</pre>
        </section>
      ) : null}

      <section className="pkg-section" id="badge" aria-labelledby="pkg-badge">
        <h2 id="pkg-badge">Show this score in your README</h2>
        <BadgeEmbedGallery cloudBaseUrl={cloudBase} packageName={packageName} badgeCacheKey={score.computedAt} />
      </section>
    </main>
  );
}

/** 12 days, 5 months, 2 years. */
function formatAge(days: number): string {
  if (days < 60) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
}

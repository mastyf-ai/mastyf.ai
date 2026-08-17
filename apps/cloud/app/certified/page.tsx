import Link from 'next/link';
import { listRecentPackageScores } from '@/lib/package-score-resolver';
import { computeTrustGrade, trustGradeColor } from '@/lib/trust-badge-grade';
import { resolveCloudBaseUrl } from '@/lib/trust-badge-svg';
import { BadgeLookupWidget } from '@/components/BadgeLookupWidget';
import './certified.css';
import './socket-certified.css';
import './enhanced-card.css';

export const dynamic = 'force-dynamic';

function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

function freshnessLabel(days: number): string {
  if (days <= 1) return 'Updated today';
  if (days <= 7) return `Updated ${days}d ago`;
  if (days <= 30) return `Updated ${Math.floor(days / 7)}w ago`;
  if (days <= 90) return `Updated ${Math.floor(days / 30)}mo ago`;
  return `Updated ${Math.floor(days / 365)}y ago`;
}

function freshnessClass(days: number): string {
  if (days <= 30) return 'fresh';
  if (days <= 90) return 'moderate';
  return 'stale';
}

function extractCheckData(checks: unknown[]): {
  description: string;
  downloads: number;
  cveTotal: number;
  cveCritical: number;
  supplyChainScore: number;
  provenanceVerified: boolean;
  githubAdvisoryCount: number;
  maxCvss: number;
  license: string;
  packageAgeDays: number;
  lastPublishedDays: number;
  depConfusionDetected: boolean;
  malwareSignalCount: number;
  maintainerCount: number;
} {
  const result = {
    description: '',
    downloads: 0,
    cveTotal: 0,
    cveCritical: 0,
    supplyChainScore: 0,
    provenanceVerified: false,
    githubAdvisoryCount: 0,
    maxCvss: 0,
    license: 'unknown',
    packageAgeDays: 0,
    lastPublishedDays: 0,
    depConfusionDetected: false,
    malwareSignalCount: 0,
    maintainerCount: 0,
  };

  for (const check of checks) {
    if (typeof check !== 'object' || check === null) continue;
    const c = check as Record<string, unknown>;

    if (c.id === 'npm-metadata') {
      result.description = typeof c.description === 'string' ? c.description : '';
      result.downloads = typeof c.downloads === 'number' ? c.downloads : 0;
      result.license = typeof c.license === 'string' ? c.license : 'unknown';
      result.packageAgeDays = typeof c.packageAgeDays === 'number' ? c.packageAgeDays : 0;
      result.lastPublishedDays = typeof c.lastPublishedDays === 'number' ? c.lastPublishedDays : 0;
      result.maintainerCount = typeof c.maintainerCount === 'number' ? c.maintainerCount : 0;
    }
    if (c.id === 'cve-scan') {
      result.cveTotal = typeof c.total === 'number' ? c.total : 0;
      result.cveCritical = typeof c.critical === 'number' ? c.critical : 0;
      result.maxCvss = typeof c.maxCvss === 'number' ? c.maxCvss : 0;
    }
    if (c.id === 'supply-chain') {
      result.supplyChainScore = typeof c.score === 'number' ? c.score : 0;
      result.depConfusionDetected = c.depConfusionDetected === true;
      result.malwareSignalCount = typeof c.malwareSignalCount === 'number' ? c.malwareSignalCount : 0;
    }
    if (c.id === 'provenance') {
      result.provenanceVerified = c.verified === true;
    }
    if (c.id === 'github-advisories') {
      result.githubAdvisoryCount = typeof c.count === 'number' ? c.count : 0;
    }
  }

  return result;
}

function getPillarScores(scoreReport: {
  categories?: Array<{ name: string; score: number }>;
}): {
  supplyChain: number;
  interfaceSecurity: number;
  runtimeBehavior: number;
  operationalTrust: number;
} {
  const cats = scoreReport.categories ?? [];
  const find = (names: string[]) => {
    const found = cats.find((c) => names.some((n) => c.name.toLowerCase().includes(n.toLowerCase())));
    return found?.score ?? 50;
  };

  return {
    supplyChain: find(['supply chain', 'provenance', 'integrity']),
    interfaceSecurity: find(['auth', 'transport', 'tool capability']),
    runtimeBehavior: find(['attack', 'malware', 'egress', 'response']),
    operationalTrust: find(['freshness', 'hygiene', 'cve']),
  };
}

function pillarGrade(score: number): string {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function pillarColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#3b82f6';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function riskLabel(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'Enterprise Ready', color: '#16a34a' };
  if (score >= 65) return { label: 'Production Ready', color: '#3b82f6' };
  if (score >= 40) return { label: 'Proceed with Caution', color: '#f59e0b' };
  return { label: 'Critical Risk', color: '#dc2626' };
}

function confidenceMark(checks: unknown[]): 'verified' | 'estimated' {
  for (const check of checks) {
    if (typeof check !== 'object' || check === null) continue;
    const c = check as Record<string, unknown>;
    if (c.id === 'supply-chain' && c.source === 'socket_api') return 'verified';
  }
  for (const check of checks) {
    if (typeof check !== 'object' || check === null) continue;
    const c = check as Record<string, unknown>;
    if (c.id === 'cve-scan' && typeof c.total === 'number' && c.total > 0) return 'verified';
  }
  return 'estimated';
}

function confidencePercent(checks: unknown[]): number {
  let sources = 0;
  for (const check of checks) {
    if (typeof check !== 'object' || check === null) continue;
    const c = check as Record<string, unknown>;
    if (c.source === 'socket_api' || (c.id === 'cve-scan' && typeof c.total === 'number' && c.total > 0)) {
      sources++;
    }
  }
  return Math.min(100, 40 + sources * 15);
}

function formatMaxCvss(cves: unknown[]): string {
  const checks = cves.filter((c): c is Record<string, unknown> =>
    typeof c === 'object' && c !== null && (c as Record<string, unknown>).id === 'cve-scan'
  );
  if (checks.length === 0) return '';
  const maxCvss = checks[0].maxCvss;
  return typeof maxCvss === 'number' && maxCvss > 0 ? maxCvss.toFixed(1) : '';
}

export default async function CertifiedDirectoryPage() {
  const cloudBase = resolveCloudBaseUrl();
  let scores: Awaited<ReturnType<typeof listRecentPackageScores>> = [];
  let error: string | null = null;
  try {
    scores = await listRecentPackageScores(7000);
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
              const checkData = extractCheckData(c.checks);
              const pillars = getPillarScores(c.scoreReport);
              const confidence = confidenceMark(c.checks);
              const confPct = confidencePercent(c.checks);
              const freshness = daysSince(c.computedAt);
              const risk = riskLabel(c.score);
              const maxCvss = formatMaxCvss(c.checks);

              return (
                <Link
                  key={c.id}
                  href={`/certified/${encodeURIComponent(c.packageName)}`}
                  className="certified-package-card card-elevated"
                >
                  {/* Header: name + version + risk label */}
                  <div className="certified-card-header">
                    <span className="certified-package-name">{c.packageName}</span>
                    <span className="certified-card-version">v{c.version}</span>
                  </div>

                  {/* Risk label */}
                  <div className="certified-card-risk-label" style={{ color: risk.color }}>
                    {risk.label}
                  </div>

                  {/* Description */}
                  {checkData.description && (
                    <p className="certified-card-description">
                      {checkData.description.length > 80
                        ? checkData.description.substring(0, 80) + '...'
                        : checkData.description}
                    </p>
                  )}

                  {/* Stats row: downloads + CVEs + license */}
                  <div className="certified-card-stats">
                    {checkData.downloads > 0 && (
                      <span className="certified-stat" title="Monthly downloads">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        {formatDownloads(checkData.downloads)}/mo
                      </span>
                    )}
                    {checkData.cveTotal > 0 ? (
                      <span className={`certified-stat certified-stat-vuln`} title={`${checkData.cveTotal} CVEs`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        {checkData.cveTotal} CVE{checkData.cveTotal !== 1 ? 's' : ''}
                        {maxCvss && (
                          <span className="certified-stat-cvss"> (CVSS {maxCvss})</span>
                        )}
                      </span>
                    ) : (
                      <span className="certified-stat certified-stat-clean" title="No CVEs">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        No CVEs
                      </span>
                    )}
                    {checkData.license && checkData.license !== 'unknown' && (
                      <span className="certified-stat certified-stat-license" title={`License: ${checkData.license}`}>
                        {checkData.license}
                      </span>
                    )}
                    {checkData.provenanceVerified && (
                      <span className="certified-stat certified-stat-provenance" title="Provenance verified">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        Verified
                      </span>
                    )}
                  </div>

                  {/* Pillar mini-badges */}
                  <div className="certified-card-pillars">
                    <span className="certified-pillar" title={`Supply Chain: ${pillars.supplyChain}/100`}>
                      <span className="certified-pillar-dot" style={{ background: pillarColor(pillars.supplyChain) }} />
                      SC
                    </span>
                    <span className="certified-pillar" title={`Interface Security: ${pillars.interfaceSecurity}/100`}>
                      <span className="certified-pillar-dot" style={{ background: pillarColor(pillars.interfaceSecurity) }} />
                      IS
                    </span>
                    <span className="certified-pillar" title={`Runtime Behavior: ${pillars.runtimeBehavior}/100`}>
                      <span className="certified-pillar-dot" style={{ background: pillarColor(pillars.runtimeBehavior) }} />
                      RB
                    </span>
                    <span className="certified-pillar" title={`Operational Trust: ${pillars.operationalTrust}/100`}>
                      <span className="certified-pillar-dot" style={{ background: pillarColor(pillars.operationalTrust) }} />
                      OT
                    </span>
                  </div>

                  {/* Dimension breakdown (top 3 lowest) */}
                  <div className="certified-card-breakdown">
                    {c.scoreReport?.categories
                      ?.slice()
                      .sort((a, b) => a.score - b.score)
                      .slice(0, 3)
                      .map((cat) => (
                        <span key={cat.name} className="certified-dim-bar" title={`${cat.name}: ${cat.score}/100`}>
                          <span className="certified-dim-label">{cat.name.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <span className="certified-dim-track">
                            <span
                              className="certified-dim-fill"
                              style={{
                                width: `${cat.score}%`,
                                background: pillarColor(cat.score),
                              }}
                            />
                          </span>
                          <span className="certified-dim-score">{cat.score}</span>
                        </span>
                      ))}
                  </div>

                  {/* Footer: score + tier + freshness */}
                  <div className="certified-package-footer">
                    <span
                      className="socket-score-pill"
                      style={{ background: trustGradeColor(grade) }}
                    >
                      {c.score}/100 · {grade}
                    </span>
                    <span className="certified-card-meta">
                      <span className={`certified-scan-tier certified-scan-${c.scanTier}`}>
                        {c.scanTier}
                      </span>
                      <span className={`certified-freshness ${freshnessClass(freshness)}`}>
                        {freshnessLabel(freshness)}
                      </span>
                    </span>
                  </div>

                  {/* Confidence badge with percentage */}
                  <div className="certified-card-confidence">
                    <span className={`certified-confidence-badge certified-confidence-${confidence}`}>
                      {confidence === 'verified' ? '✓ Verified' : '○ Estimated'} · {confPct}%
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

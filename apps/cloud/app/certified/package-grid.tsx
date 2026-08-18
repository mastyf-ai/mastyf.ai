'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { computeTrustGrade, trustGradeColor } from '@/lib/trust-badge-grade';

type Package = {
  id: string;
  packageName: string;
  version: string;
  scanTier: string;
  score: number;
  grade: string;
  level: string;
  scoreReport: { categories?: Array<{ name: string; score: number; findings?: string[] }> };
  checks: unknown[];
  computedAt: string;
  expiresAt: string;
};

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

function extractCheckData(checks: unknown[]) {
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
    if (c.id === 'license' && typeof c.value === 'string') {
      result.license = c.value;
    }
    if (c.id === 'maintainers' && typeof c.count === 'number') {
      result.maintainerCount = c.count;
    }
    if (c.id === 'freshness') {
      result.packageAgeDays = typeof c.packageAgeDays === 'number' ? c.packageAgeDays : result.packageAgeDays;
      result.lastPublishedDays = typeof c.lastPublishedDays === 'number' ? c.lastPublishedDays : result.lastPublishedDays;
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
    if (c.id === 'cve-free') {
      result.cveTotal = 0;
      result.cveCritical = 0;
    }
  }

  return result;
}

function getPillarScores(scoreReport: {
  categories?: Array<{ name: string; score: number }>;
}) {
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
  let enrichedSources = 0;
  for (const check of checks) {
    if (typeof check !== 'object' || check === null) continue;
    const c = check as Record<string, unknown>;
    if (c.id === 'npm-metadata' && typeof c.downloads === 'number' && c.downloads > 0) enrichedSources++;
    if (c.id === 'cve-scan' && typeof c.total === 'number') enrichedSources++;
    if (c.id === 'supply-chain' && typeof c.depCount === 'number') enrichedSources++;
    if (c.id === 'provenance' && c.verified === true) enrichedSources++;
    if (c.id === 'github-advisories' && typeof c.count === 'number') enrichedSources++;
    if (c.id === 'freshness' && typeof c.lastPublishedDays === 'number') enrichedSources++;
    if (c.id === 'license' && typeof c.value === 'string' && c.value !== 'unknown') enrichedSources++;
    if (c.id === 'mastyf-ai-score-report' && typeof c.overallScore === 'number') enrichedSources += 2;
    if (c.id === 'supply-chain' && c.source === 'socket_api') enrichedSources += 3;
  }
  return enrichedSources >= 3 ? 'verified' : 'estimated';
}

function confidencePercent(checks: unknown[]): number {
  let sources = 0;
  for (const check of checks) {
    if (typeof check !== 'object' || check === null) continue;
    const c = check as Record<string, unknown>;
    if (c.id === 'npm-metadata' && typeof c.downloads === 'number' && c.downloads > 0) sources++;
    if (c.id === 'cve-scan' && typeof c.total === 'number') sources++;
    if (c.id === 'supply-chain' && typeof c.depCount === 'number') sources++;
    if (c.id === 'provenance' && c.verified === true) sources++;
    if (c.id === 'freshness' && typeof c.lastPublishedDays === 'number') sources++;
    if (c.id === 'license' && typeof c.value === 'string' && c.value !== 'unknown') sources++;
    if (c.id === 'mastyf-ai-score-report' && typeof c.overallScore === 'number') sources += 2;
    if (c.id === 'supply-chain' && c.source === 'socket_api') sources += 3;
  }
  return Math.min(100, 30 + sources * 10);
}

function formatMaxCvss(checks: unknown[]): string {
  for (const check of checks) {
    if (typeof check !== 'object' || check === null) continue;
    const c = check as Record<string, unknown>;
    if (c.id === 'cve-scan' && typeof c.maxCvss === 'number' && c.maxCvss > 0) {
      return c.maxCvss.toFixed(1);
    }
  }
  return '';
}

function PackageCard({ pkg }: { pkg: Package }) {
  const grade = pkg.grade || computeTrustGrade(pkg.score);
  const checkData = extractCheckData(pkg.checks);
  const pillars = getPillarScores(pkg.scoreReport);
  const conf = confidenceMark(pkg.checks);
  const confPct = confidencePercent(pkg.checks);
  const freshness = daysSince(pkg.computedAt);
  const risk = riskLabel(pkg.score);
  const maxCvss = formatMaxCvss(pkg.checks);

  return (
    <Link
      href={`/certified/${encodeURIComponent(pkg.packageName)}`}
      className="certified-package-card card-elevated"
    >
      <div className="certified-card-header">
        <span className="certified-package-name">{pkg.packageName}</span>
        <span className="certified-card-version">v{pkg.version}</span>
      </div>

      <div className="certified-card-risk-label" style={{ color: risk.color }}>
        {risk.label}
      </div>

      {checkData.description && (
        <p className="certified-card-description">
          {checkData.description.length > 80
            ? checkData.description.substring(0, 80) + '...'
            : checkData.description}
        </p>
      )}

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
          <span className="certified-stat certified-stat-vuln" title={`${checkData.cveTotal} CVEs`}>
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
          <span className="certified-stat certified-stat-clean" title="No CVEs found in last scan">
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

      <div className="certified-card-breakdown">
        {pkg.scoreReport?.categories
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

      <div className="certified-package-footer">
        <span
          className="socket-score-pill"
          style={{ background: trustGradeColor(grade) }}
        >
          {pkg.score}/100 · {grade}
        </span>
        <span className="certified-card-meta">
          <span className={`certified-scan-tier certified-scan-${pkg.scanTier}`}>
            {pkg.scanTier}
          </span>
          <span className={`certified-freshness ${freshnessClass(freshness)}`}>
            {freshnessLabel(freshness)}
          </span>
        </span>
      </div>

      <div className="certified-card-confidence">
        <span className={`certified-confidence-badge certified-confidence-${conf}`}>
          {conf === 'verified' ? '✓ Verified' : '○ Estimated'} · {confPct}%
        </span>
      </div>
    </Link>
  );
}

const PAGE_SIZE = 50;

export function PackageGrid() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const fetchPackages = useCallback(async (off: number, q: string, append: boolean) => {
    try {
      const params = new URLSearchParams({ offset: String(off), limit: String(PAGE_SIZE) });
      if (q) params.set('q', q);
      const res = await fetch(`/api/v1/scores/recent?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (append) {
        setPackages((prev) => [...prev, ...data.packages]);
      } else {
        setPackages(data.packages);
      }
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setOffset(0);
    fetchPackages(0, debouncedSearch, false).finally(() => setLoading(false));
  }, [debouncedSearch, fetchPackages]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadMore = async () => {
    const nextOffset = packages.length;
    setLoadingMore(true);
    await fetchPackages(nextOffset, debouncedSearch, true);
    setOffset(nextOffset);
    setLoadingMore(false);
  };

  return (
    <>
      <div className="certified-recent-header">
        <h2>Recently scored packages</h2>
        {total > 0 && (
          <span className="certified-recent-count">{total} packages</span>
        )}
      </div>

      <div className="certified-search-bar" style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Search packages..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="certified-search-input"
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)',
            color: '#fff',
            fontSize: '0.95rem',
            outline: 'none',
          }}
        />
      </div>

      {error ? (
        <p role="alert" className="certified-error card-elevated" style={{ padding: '1.25rem' }}>
          {error}
        </p>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
          Loading packages...
        </div>
      ) : packages.length === 0 ? (
        <p className="certified-hero-lead" style={{ textAlign: 'left' }}>
          No cached scores yet. Look up a package above — scores are computed on demand from npm
          and CVE feeds.
        </p>
      ) : (
        <>
          <div className="certified-package-grid">
            {packages.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
          {hasMore && (
            <div style={{ textAlign: 'center', padding: '1.5rem', gridColumn: '1 / -1' }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(99,102,241,0.3)',
                  color: '#fff',
                  fontSize: '1rem',
                  fontWeight: 600,
                  cursor: loadingMore ? 'wait' : 'pointer',
                  transition: 'background 0.2s',
                  minWidth: '200px',
                }}
              >
                {loadingMore ? 'Loading...' : `Load more (${packages.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

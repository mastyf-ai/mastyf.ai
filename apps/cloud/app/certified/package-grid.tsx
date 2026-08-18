'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { computeTrustGrade, trustGradeColor } from '@/lib/trust-badge-grade';
import {
  mergePackageData,
  formatDownloads,
  formatDays,
} from '@/lib/package-data-merge';

type Package = {
  id: string;
  packageName: string;
  version: string;
  scanTier: string;
  score: number;
  grade: string;
  level: string;
  scoreReport: { categories?: Array<{ name: string; score: number; weight?: number; findings?: string[] }> };
  checks: unknown[];
  computedAt: string;
  expiresAt: string;
};

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

function getPillarScores(scoreReport: {
  categories?: Array<{ name: string; score: number }>;
}) {
  const cats = scoreReport.categories ?? [];
  const find = (names: string[]) => {
    const found = cats.find((c) => names.some((n) => c.name.toLowerCase().includes(n.toLowerCase())));
    return found?.score ?? 50;
  };

  return {
    supplyChain: find(['supply chain', 'provenance', 'integrity', 'cve', 'dependency hygiene']),
    interfaceSecurity: find(['auth', 'transport', 'tool capability']),
    runtimeBehavior: find(['attack', 'malware', 'egress', 'response', 'live health']),
    operationalTrust: find(['freshness', 'hygiene', 'license', 'download']),
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

function formatMaxCvss(cves: { maxCvss?: number }): string {
  return cves.maxCvss && cves.maxCvss > 0 ? cves.maxCvss.toFixed(1) : '';
}

function PackageCard({ pkg }: { pkg: Package }) {
  const grade = pkg.grade || computeTrustGrade(pkg.score);
  const data = mergePackageData(
    pkg.scoreReport as never,
    pkg.checks,
    pkg.score,
    grade,
    pkg.level,
    pkg.version,
  );
  const pillars = getPillarScores(pkg.scoreReport);
  const conf = confidenceMark(pkg.checks);
  const confPct = confidencePercent(pkg.checks);
  const freshness = daysSince(pkg.computedAt);
  const risk = riskLabel(pkg.score);
  const maxCvss = formatMaxCvss(data.cves);

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

      {data.description && (
        <p className="certified-card-description">
          {data.description.length > 80
            ? data.description.substring(0, 80) + '...'
            : data.description}
        </p>
      )}

      <div className="certified-card-stats">
        {data.downloads !== undefined && data.downloads > 0 && (
          <span className="certified-stat" title="Weekly downloads">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {formatDownloads(data.downloads)}/wk
          </span>
        )}
        {data.cves.total > 0 ? (
          <span className="certified-stat certified-stat-vuln" title={`${data.cves.total} CVEs`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {data.cves.total} CVE{data.cves.total !== 1 ? 's' : ''}
            {maxCvss && (
              <span className="certified-stat-cvss"> (CVSS {maxCvss})</span>
            )}
          </span>
        ) : (
          <span className="certified-stat certified-stat-clean" title="No known CVEs">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            No CVEs
          </span>
        )}
        {data.license && data.license !== 'unknown' && (
          <span className="certified-stat certified-stat-license" title={`License: ${data.license}`}>
            {data.license}
          </span>
        )}
        {data.cveFree === false && (
          <span className="certified-stat certified-stat-critical" title="CVE-free check failed">
            CVE check fail
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
        {data.categories
          .slice()
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

function pageNumbers(current: number, totalPages: number): number[] {
  const pages = new Set<number>();
  pages.add(1);
  pages.add(totalPages);
  for (let i = Math.max(2, current - 2); i <= Math.min(totalPages - 1, current + 2); i++) {
    pages.add(i);
  }
  return [...pages].sort((a, b) => a - b);
}

export function PackageGrid() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchPackages = useCallback(async (p: number, q: string) => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ offset: String((p - 1) * PAGE_SIZE), limit: String(PAGE_SIZE) });
      if (q) params.set('q', q);
      const res = await fetch(`/api/v1/scores/recent?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPackages(data.packages ?? []);
      setTotal(data.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    fetchPackages(page, debouncedSearch);
  }, [page, debouncedSearch, fetchPackages]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

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
          {totalPages > 1 && (
            <nav className="certified-pagination" aria-label="Pagination">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="certified-page-btn"
              >
                ‹ Prev
              </button>
              {pageNumbers(page, totalPages).map((n, i, arr) => (
                <span key={n} className="certified-page-group">
                  {i > 0 && arr[i - 1] !== n - 1 ? <span className="certified-page-ellipsis">…</span> : null}
                  <button
                    onClick={() => setPage(n)}
                    className={`certified-page-btn ${n === page ? 'certified-page-active' : ''}`}
                    aria-current={n === page ? 'page' : undefined}
                  >
                    {n}
                  </button>
                </span>
              ))}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="certified-page-btn"
              >
                Next ›
              </button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
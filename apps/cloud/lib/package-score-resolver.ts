/**
 * Resolve MCP package scores on demand with Postgres cache + optional attestation override.
 */
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPublicCertificationByPackage } from '@/lib/industry-standard';
import type { PublishableScoreReport } from '@/lib/score-report';
import { parseScoreReportFromChecks } from '@/lib/score-report';
import { computeTrustGrade, scoreToLevel } from '@/lib/trust-badge-grade';

export type PackageScoreSource = 'computed' | 'attested';
export type PackageScoreTier = 'static' | 'live';

export type PackageScoreResult = {
  id: string;
  packageName: string;
  version: string;
  serverName: string;
  score: number;
  grade: string;
  level: string;
  scanTier: PackageScoreTier;
  source: PackageScoreSource;
  includesLiveData: boolean;
  scoreReport: PublishableScoreReport;
  checks: unknown[];
  computedAt: string;
  expiresAt: string;
  attestationJws?: string;
};

type CacheRow = {
  package_name: string;
  version: string;
  scan_tier: string;
  score: number;
  level: string;
  grade: string;
  score_report: PublishableScoreReport;
  checks: unknown[];
  computed_at: string;
  expires_at: string;
};

const STATIC_TTL_MS = 24 * 60 * 60 * 1000;
const LIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class PackageNotFoundError extends Error {
  constructor(packageName: string) {
    super(`Package not found: ${packageName}`);
    this.name = 'PackageNotFoundError';
  }
}

export class InvalidPackageNameError extends Error {
  constructor() {
    super('invalid_package_name');
    this.name = 'InvalidPackageNameError';
  }
}

async function loadScorer() {
  try {
    return await import('@mastyf-ai/server/package-scorer');
  } catch {
    return await import('./package-scorer-stub');
  }
}

function rowToResult(row: CacheRow, source: PackageScoreSource, id?: string): PackageScoreResult {
  return {
    id: id ?? `${row.package_name}:${row.version}:${row.scan_tier}`,
    packageName: row.package_name,
    version: row.version,
    serverName: row.package_name.split('/').pop() ?? row.package_name,
    score: Number(row.score),
    grade: row.grade,
    level: row.level,
    scanTier: row.scan_tier as PackageScoreTier,
    source,
    includesLiveData: row.scan_tier === 'live',
    scoreReport: row.score_report,
    checks: Array.isArray(row.checks) ? row.checks : [],
    computedAt: String(row.computed_at),
    expiresAt: String(row.expires_at),
  };
}

async function readStaleCache(
  packageName: string,
  tier?: PackageScoreTier,
): Promise<CacheRow | null> {
  try {
    const db = getDb();
    const result = tier
      ? await db.execute(sql`
          SELECT package_name, version, scan_tier, score, level, grade,
                 score_report, checks, computed_at, expires_at
          FROM package_score_cache
          WHERE package_name = ${packageName}
            AND scan_tier = ${tier}
          ORDER BY computed_at DESC
          LIMIT 1
        `)
      : await db.execute(sql`
          SELECT package_name, version, scan_tier, score, level, grade,
                 score_report, checks, computed_at, expires_at
          FROM package_score_cache
          WHERE package_name = ${packageName}
          ORDER BY CASE scan_tier WHEN 'live' THEN 0 ELSE 1 END, computed_at DESC
          LIMIT 1
        `);
    const rows = result as unknown as CacheRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function resolvePackageScoreWithStale(
  packageName: string,
): Promise<{ score: PackageScoreResult; stale: boolean }> {
  const fresh = await readCache(packageName);
  if (fresh) return { score: rowToResult(fresh, 'computed'), stale: false };
  const staleRow = await readStaleCache(packageName);
  if (staleRow) return { score: rowToResult(staleRow, 'computed'), stale: true };
  const score = await resolvePackageScore(packageName);
  return { score, stale: false };
}

async function readCache(
  packageName: string,
  tier?: PackageScoreTier,
): Promise<CacheRow | null> {
  try {
    const db = getDb();
    const result = tier
      ? await db.execute(sql`
          SELECT package_name, version, scan_tier, score, level, grade,
                 score_report, checks, computed_at, expires_at
          FROM package_score_cache
          WHERE package_name = ${packageName}
            AND scan_tier = ${tier}
            AND expires_at > NOW()
          ORDER BY computed_at DESC
          LIMIT 1
        `)
      : await db.execute(sql`
          SELECT package_name, version, scan_tier, score, level, grade,
                 score_report, checks, computed_at, expires_at
          FROM package_score_cache
          WHERE package_name = ${packageName}
            AND expires_at > NOW()
          ORDER BY CASE scan_tier WHEN 'live' THEN 0 ELSE 1 END, computed_at DESC
          LIMIT 1
        `);
    const rows = result as unknown as CacheRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function writeCache(
  scored: Awaited<ReturnType<Awaited<ReturnType<typeof loadScorer>>['scorePackageStatic']>>,
  tier: PackageScoreTier,
): Promise<void> {
  const ttl = tier === 'live' ? LIVE_TTL_MS : STATIC_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO package_score_cache (
      package_name, version, scan_tier, score, level, grade,
      score_report, checks, computed_at, expires_at
    ) VALUES (
      ${scored.packageName},
      ${scored.version},
      ${tier},
      ${scored.score},
      ${scored.level},
      ${scored.grade},
      ${JSON.stringify(scored.scoreReport)}::jsonb,
      ${JSON.stringify(scored.checks)}::jsonb,
      ${scored.computedAt}::timestamptz,
      ${expiresAt}::timestamptz
    )
    ON CONFLICT (package_name, version, scan_tier) DO UPDATE SET
      score = EXCLUDED.score,
      level = EXCLUDED.level,
      grade = EXCLUDED.grade,
      score_report = EXCLUDED.score_report,
      checks = EXCLUDED.checks,
      computed_at = EXCLUDED.computed_at,
      expires_at = EXCLUDED.expires_at
  `);
}

function attestationToResult(
  cert: Awaited<ReturnType<typeof getPublicCertificationByPackage>> & { attestationJws?: string },
): PackageScoreResult | null {
  if (!cert) return null;
  const checks = Array.isArray(cert.checks) ? cert.checks : [];
  const scoreReport =
    parseScoreReportFromChecks(checks) ?? {
      overallScore: cert.score,
      grade: computeTrustGrade(cert.score),
      summaryPlainEnglish: `Maintainer-attested score ${cert.score}/100.`,
      categories: [],
      improvementActions: [],
      issues: [],
    };

  return {
    id: cert.id,
    packageName: cert.packageName,
    version: cert.version,
    serverName: cert.serverName,
    score: cert.score,
    grade: computeTrustGrade(cert.score),
    level: cert.level || scoreToLevel(cert.score),
    scanTier: 'live',
    source: 'attested',
    includesLiveData: true,
    scoreReport,
    checks: cert.checks,
    computedAt: cert.issuedAt,
    expiresAt: cert.expiresAt,
    attestationJws: cert.attestationJws,
  };
}

async function loadAttestedScore(
  packageName: string,
): Promise<PackageScoreResult | null> {
  try {
    const attested = await getPublicCertificationByPackage(packageName);
    return attested ? attestationToResult(attested) : null;
  } catch {
    return null;
  }
}

/** Prefer on-demand live cache when it is newer than maintainer attestation. */
function pickLiveOrAttested(
  liveCached: CacheRow | null,
  attested: PackageScoreResult | null,
): PackageScoreResult | null {
  if (liveCached && attested) {
    const liveMs = new Date(String(liveCached.computed_at)).getTime();
    const attMs = new Date(attested.computedAt).getTime();
    return liveMs >= attMs
      ? rowToResult(liveCached, 'computed')
      : attested;
  }
  if (liveCached) return rowToResult(liveCached, 'computed');
  return attested;
}

export async function resolvePackageScore(
  packageName: string,
  opts?: {
    tier?: PackageScoreTier;
    skipAttestation?: boolean;
    /** Bypass cache and recompute (deep scan). */
    forceRefresh?: boolean;
  },
): Promise<PackageScoreResult> {
  const name = packageName.trim();
  const scorer = await loadScorer();
  if (!scorer.isValidNpmPackageName(name)) {
    throw new InvalidPackageNameError();
  }

  const requestedTier = opts?.tier;

  if (!opts?.forceRefresh) {
    const liveCached = await readCache(name, 'live');
    const attested = opts?.skipAttestation ? null : await loadAttestedScore(name);

    if (!requestedTier) {
      const preferred = pickLiveOrAttested(liveCached, attested);
      if (preferred) return preferred;
      const cached = await readCache(name, undefined);
      if (cached) return rowToResult(cached, 'computed');
    } else if (requestedTier === 'live') {
      const preferred = pickLiveOrAttested(liveCached, attested);
      if (preferred?.scanTier === 'live') return preferred;
    } else {
      const staticCached = await readCache(name, 'static');
      if (staticCached) return rowToResult(staticCached, 'computed');
    }
  }

  try {
    const scored =
      requestedTier === 'live'
        ? await scorer.scorePackageLive(name)
        : await scorer.scorePackageStatic(name);

    try {
      await writeCache(scored, scored.scanTier);
    } catch {
      /* cache optional when DATABASE_URL unset */
    }

    return {
      id: randomUUID(),
      packageName: scored.packageName,
      version: scored.version,
      serverName: scored.serverName,
      score: scored.score,
      grade: scored.grade,
      level: scored.level,
      scanTier: scored.scanTier,
      source: 'computed',
      includesLiveData: scored.includesLiveData,
      scoreReport: scored.scoreReport,
      checks: scored.checks,
      computedAt: scored.computedAt,
      expiresAt: new Date(
        Date.now() + (scored.scanTier === 'live' ? LIVE_TTL_MS : STATIC_TTL_MS),
      ).toISOString(),
    };
  } catch (err: unknown) {
    if (err instanceof scorer.NpmPackageNotFoundError) {
      throw new PackageNotFoundError(name);
    }
    if (err instanceof Error && err.message === 'invalid_package_name') {
      throw new InvalidPackageNameError();
    }
    throw err;
  }
}

export async function listRecentPackageScores(limit = 200): Promise<PackageScoreResult[]> {
  try {
    const db = getDb();
    const capped = Math.min(limit, 500);
    const result = await db.execute(sql`
      SELECT package_name, version, scan_tier, score, level, grade,
             score_report, checks, computed_at, expires_at
      FROM package_score_cache
      WHERE expires_at > NOW()
      ORDER BY computed_at DESC
      LIMIT ${capped}
    `);
    const rows = result as unknown as CacheRow[];
    return rows.map((r) => rowToResult(r, 'computed'));
  } catch {
    return [];
  }
}

export function isDeepScanEnabled(): boolean {
  if (process.env.MASTYF_AI_DISABLE_DEEP_SCAN === 'true') return false;
  const url = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || '';
  if (url.includes('localhost') || url.includes('127.0.0.1')) return true;
  if (process.env.NODE_ENV === 'development') return true;
  return process.env.MASTYF_AI_ENABLE_DEEP_SCAN === 'true';
}

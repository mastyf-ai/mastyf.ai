/**
 * GitHub Advisory enrichment — fetches vulnerability data from GitHub's Advisory Database.
 * Uses the public API (no token needed for basic queries, rate-limited to 10 req/min).
 * With GITHUB_TOKEN, rate limit increases to 30 req/min.
 */

export type GitHubAdvisory = {
  ghsaId: string;
  cveId: string | null;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
  publishedAt: string;
  updatedAt: string;
  withdrawnAt: string | null;
  fixedVersion: string | null;
  ecosystem: string;
};

export type GitHubAdvisoryEnrichment = {
  packageName: string;
  advisoryCount: number;
  criticalAdvisoryCount: number;
  highAdvisoryCount: number;
  newestAdvisoryAgeDays: number;
  advisories: GitHubAdvisory[];
  status: 'ok' | 'degraded' | 'unavailable';
};

const GITHUB_API = 'https://api.github.com';
const TIMEOUT_MS = 10000;
const MEMORY_CACHE = new Map<string, { data: GitHubAdvisoryEnrichment; ts: number }>();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

export async function enrichGitHubAdvisories(packageName: string): Promise<GitHubAdvisoryEnrichment> {
  const cacheKey = packageName;
  const cached = MEMORY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const params = new URLSearchParams({
      ecosystem: 'npm',
      package: packageName,
      per_page: '30',
      sort: 'published',
      direction: 'desc',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${GITHUB_API}/advisories?${params}`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const result: GitHubAdvisoryEnrichment = {
        packageName,
        advisoryCount: 0,
        criticalAdvisoryCount: 0,
        highAdvisoryCount: 0,
        newestAdvisoryAgeDays: 0,
        advisories: [],
        status: 'unavailable',
      };
      MEMORY_CACHE.set(cacheKey, { data: result, ts: Date.now() });
      return result;
    }

    const data = (await res.json()) as Array<{
      ghsa_id: string;
      cve_id: string | null;
      severity: string;
      summary: string;
      published_at: string;
      updated_at: string;
      withdrawn_at: string | null;
      vulnerabilities?: Array<{ package: { ecosystem: string }; first_patched_version?: string }>;
    }>;

    const advisories: GitHubAdvisory[] = data
      .filter((a) => !a.withdrawn_at) // skip withdrawn advisories
      .map((a) => {
        const patched = a.vulnerabilities?.[0]?.first_patched_version;
        const severity = a.severity.toUpperCase();
        const mappedSeverity: GitHubAdvisory['severity'] =
          severity === 'CRITICAL' ? 'CRITICAL' :
          severity === 'HIGH' ? 'HIGH' :
          severity === 'MEDIUM' ? 'MEDIUM' : 'LOW';
        return {
          ghsaId: a.ghsa_id,
          cveId: a.cve_id,
          severity: mappedSeverity,
          summary: a.summary,
          publishedAt: a.published_at,
          updatedAt: a.updated_at,
          withdrawnAt: a.withdrawn_at,
          fixedVersion: patched ?? null,
          ecosystem: 'npm',
        };
      });

    const newestAge = advisories.length > 0
      ? Math.min(...advisories.map((a) => daysSince(a.publishedAt)))
      : 0;

    const result: GitHubAdvisoryEnrichment = {
      packageName,
      advisoryCount: advisories.length,
      criticalAdvisoryCount: advisories.filter((a) => a.severity === 'CRITICAL').length,
      highAdvisoryCount: advisories.filter((a) => a.severity === 'HIGH').length,
      newestAdvisoryAgeDays: newestAge,
      advisories,
      status: 'ok',
    };

    MEMORY_CACHE.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch {
    const result: GitHubAdvisoryEnrichment = {
      packageName,
      advisoryCount: 0,
      criticalAdvisoryCount: 0,
      highAdvisoryCount: 0,
      newestAdvisoryAgeDays: 0,
      advisories: [],
      status: 'degraded',
    };
    MEMORY_CACHE.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  }
}

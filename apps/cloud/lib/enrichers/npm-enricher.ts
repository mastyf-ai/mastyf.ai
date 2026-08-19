/**
 * npm registry enrichment — fetches metadata, download counts, and package age.
 * Uses public APIs: registry.npmjs.org + api.npmjs.org (no keys needed).
 */

export type NpmEnrichment = {
  packageName: string;
  version: string;
  description: string;
  homepage: string;
  repository: string;
  license: string;
  maintainers: string[];
  downloadsLast30Days: number;
  downloadsLast7Days: number;
  packageAgeDays: number;
  lastPublishedDays: number;
  dependencyCount: number;
  hasReadme: boolean;
  hasKeywords: boolean;
  keywords: string[];
};

const REGISTRY_BASE = 'https://registry.npmjs.org';
const DOWNLOADS_API = 'https://api.npmjs.org/downloads';
const TIMEOUT_MS = 8000;
const RETRY_COUNT = 2;

async function fetchWithRetry(url: string, retries = RETRY_COUNT): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

export async function enrichFromNpm(packageName: string): Promise<NpmEnrichment> {
  const encoded = encodeURIComponent(packageName);

  // Fetch full registry document (contains metadata, versions, time)
  const registryRes = await fetchWithRetry(`${REGISTRY_BASE}/${encoded}`);
  if (!registryRes.ok) {
    throw new Error(`npm registry returned ${registryRes.status} for ${packageName}`);
  }
  const doc = (await registryRes.json()) as Record<string, unknown>;

  // Resolve latest version
  const distTags = (doc['dist-tags'] ?? {}) as Record<string, string>;
  const latestVersion = distTags.latest ?? '0.0.0';

  // Get version-specific metadata
  const versions = (doc.versions ?? {}) as Record<string, Record<string, unknown>>;
  const versionDoc = versions[latestVersion] ?? {};

  // Time metadata
  const time = (doc.time ?? {}) as Record<string, string>;
  const createdAt = time.created ? daysSince(time.created) : 0;
  const lastModified = time.modified ? daysSince(time.modified) : createdAt;

  // Maintainers
  const maintainers = Array.isArray(doc.maintainers)
    ? doc.maintainers.map((m: Record<string, string>) => m.name ?? '').filter(Boolean)
    : [];

  // Dependencies
  const deps = (versionDoc.dependencies ?? {}) as Record<string, unknown>;
  const depCount = Object.keys(deps).length;

  // Repository
  const repo = versionDoc.repository;
  const repoUrl = typeof repo === 'string' ? repo : (repo as { url?: string })?.url ?? '';

  // License
  const lic = versionDoc.license;
  const license = typeof lic === 'string' ? lic : (lic as { type?: string })?.type ?? 'unknown';

  // Keywords
  const keywords = Array.isArray(doc.keywords) ? doc.keywords.map(String) : [];

  // Fetch download counts (30-day and 7-day)
  let downloads30 = 0;
  let downloads7 = 0;
  try {
    const [dl30Res, dl7Res] = await Promise.all([
      fetchWithRetry(`${DOWNLOADS_API}/point/last-month/${encoded}`),
      fetchWithRetry(`${DOWNLOADS_API}/point/last-week/${encoded}`),
    ]);
    if (dl30Res.ok) {
      const dl30 = (await dl30Res.json()) as { downloads?: number };
      downloads30 = dl30.downloads ?? 0;
    }
    if (dl7Res.ok) {
      const dl7 = (await dl7Res.json()) as { downloads?: number };
      downloads7 = dl7.downloads ?? 0;
    }
  } catch {
    // Downloads API is optional — don't fail the whole enrichment
  }

  return {
    packageName: doc.name as string ?? packageName,
    version: latestVersion,
    description: (doc.description as string) ?? (versionDoc.description as string) ?? '',
    homepage: (versionDoc.homepage as string) ?? '',
    repository: repoUrl,
    license,
    maintainers,
    downloadsLast30Days: downloads30,
    downloadsLast7Days: downloads7,
    packageAgeDays: createdAt,
    lastPublishedDays: lastModified,
    dependencyCount: depCount,
    hasReadme: typeof doc.readme === 'string' && doc.readme.length > 0,
    hasKeywords: keywords.length > 0,
    keywords,
  };
}

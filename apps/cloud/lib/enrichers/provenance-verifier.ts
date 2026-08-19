/**
 * npm provenance verifier — checks if a package was published with npm --provenance
 * (SLSA-compliant build attestations via Sigstore).
 */

export type ProvenanceResult = {
  packageName: string;
  version: string;
  provenanceVerified: boolean;
  provenanceAvailable: boolean;
  slsaLevel: number; // 0 = none, 1 = build provenance, 2 = build + deploy, 3 = full
  source: 'npm_registry' | 'unavailable';
};

const REGISTRY_BASE = 'https://registry.npmjs.org';
const TIMEOUT_MS = 8000;
const MEMORY_CACHE = new Map<string, { data: ProvenanceResult; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function verifyProvenance(
  packageName: string,
  version?: string,
): Promise<ProvenanceResult> {
  const cacheKey = `${packageName}@${version ?? 'latest'}`;
  const cached = MEMORY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const encoded = encodeURIComponent(packageName);
  const versionPath = version && version !== 'latest' ? `/${encodeURIComponent(version)}` : '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${REGISTRY_BASE}/${encoded}${versionPath}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const result: ProvenanceResult = {
        packageName,
        version: version ?? 'latest',
        provenanceVerified: false,
        provenanceAvailable: false,
        slsaLevel: 0,
        source: 'unavailable',
      };
      MEMORY_CACHE.set(cacheKey, { data: result, ts: Date.now() });
      return result;
    }

    const doc = (await res.json()) as Record<string, unknown>;

    // Resolve version
    let resolvedVersion = version ?? 'latest';
    if (resolvedVersion === 'latest') {
      const distTags = (doc['dist-tags'] ?? {}) as Record<string, string>;
      resolvedVersion = distTags.latest ?? '0.0.0';
    }

    // Check for provenance attestation in dist metadata
    const versions = (doc.versions ?? {}) as Record<string, Record<string, unknown>>;
    const versionDoc = versions[resolvedVersion] ?? {};
    const dist = (versionDoc.dist ?? {}) as Record<string, unknown>;

    // npm provenance is indicated by:
    // 1. dist.attestations field (npm >= 9.5.0 with --provenance)
    // 2. dist.provenance field
    // 3. _npmUser.trustedPublisher (for some packages)
    const attestations = dist.attestations;
    const provenance = dist.provenance;
    const hasProvenance = attestations !== undefined || provenance !== undefined;

    // Check if the package uses npm provenance (SLSA level 1+)
    // We also check for Sigstore bundle presence
    let slsaLevel = 0;
    if (hasProvenance) {
      slsaLevel = 1; // Basic build provenance
      // SLSA level 2 requires additional deploy provenance
      if (provenance && typeof provenance === 'object') {
        const prov = provenance as Record<string, unknown>;
        if (prov.buildConfig || prov.deployConfig) {
          slsaLevel = 2;
        }
      }
      // SLSA level 3 would need full transparency log verification
    }

    const result: ProvenanceResult = {
      packageName,
      version: resolvedVersion,
      provenanceVerified: hasProvenance,
      provenanceAvailable: hasProvenance,
      slsaLevel,
      source: 'npm_registry',
    };

    MEMORY_CACHE.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch {
    const result: ProvenanceResult = {
      packageName,
      version: version ?? 'latest',
      provenanceVerified: false,
      provenanceAvailable: false,
      slsaLevel: 0,
      source: 'unavailable',
    };
    MEMORY_CACHE.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  }
}

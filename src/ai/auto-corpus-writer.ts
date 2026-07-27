/**
 * Auto-write validated Threat Lab discoveries to adversarial-harness custom-attacks.
 */
import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { mastyfAiHomeDir } from '../audit/tenant-audit-paths.js';
import { resolveSwarmOutputDir, resolveTenantSwarmDir } from '../tenant/swarm-tenant-paths.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import type { ThreatLabDiscovery } from './threat-lab.js';

export type AutoCorpusSource =
  | 'semantic_flag'
  | 'block_repeat'
  | 'threat_intel'
  | 'bypass'
  | 'corpus_proactive'
  | 'dependency_anomaly'
  | 'vuln_discovery';

export interface AutoCorpusProvenance {
  source: AutoCorpusSource;
  inputFingerprint: string;
  llmUsed: boolean;
  attackClass: string;
  hypothesis: string;
  confidence: number;
}

export interface AutoCorpusWriteResult {
  advId: string;
  relPath: string;
  fingerprint: string;
}

const DEFAULT_CUSTOM = join(process.cwd(), 'adversarial-harness', 'fixtures', 'custom-attacks');

export function candidateFingerprint(discovery: ThreatLabDiscovery): string {
  return createHash('sha256')
    .update(
      `${discovery.attackClass}:${discovery.corpusCandidate.toolName}:${JSON.stringify(discovery.corpusCandidate.arguments)}`,
    )
    .digest('hex')
    .slice(0, 16);
}

export function customAttacksDir(): string {
  return process.env.MASTYF_AI_AUTO_CORPUS_DIR || DEFAULT_CUSTOM;
}

/** Resolve at call time — swarm dir can change after module load (fleet/dashboard). */
export function autoCorpusManifestPath(): string {
  const explicit = process.env.MASTYF_AI_AUTO_CORPUS_MANIFEST?.trim();
  if (explicit) return explicit;
  const swarmPath = join(resolveSwarmOutputDir(), 'auto-corpus-manifest.json');
  if (existsSync(swarmPath)) return swarmPath;
  // Fleet / tenant writers often land under reports/tenants/<id>/security-swarm
  const tenantPath = join(resolveTenantSwarmDir(DEFAULT_TENANT_ID), 'auto-corpus-manifest.json');
  if (existsSync(tenantPath)) return tenantPath;
  return swarmPath;
}

export function threatResearchProcessedPath(): string {
  const base = process.env.MASTYF_AI_THREAT_RESEARCH_STATE_PATH || mastyfAiHomeDir();
  return join(base, 'threat-research-processed.json');
}

export function nextAdvId(customDir = customAttacksDir()): string {
  mkdirSync(customDir, { recursive: true });
  const files = readdirSync(customDir).filter((f) => f.startsWith('adv-') && f.endsWith('.json'));
  let max = 0;
  for (const f of files) {
    const m = f.match(/^adv-(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `adv-${String(max + 1).padStart(3, '0')}`;
}

function loadProcessedFingerprints(): Set<string> {
  const path = threatResearchProcessedPath();
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as { fingerprints?: string[] };
    return new Set(data.fingerprints || []);
  } catch {
    return new Set();
  }
}

function saveProcessedFingerprint(fp: string): void {
  const path = threatResearchProcessedPath();
  const dir = join(path, '..');
  mkdirSync(dir, { recursive: true });
  const set = loadProcessedFingerprints();
  set.add(fp);
  const kept = [...set].slice(-5000);
  writeFileSync(path, JSON.stringify({ fingerprints: kept, updatedAt: new Date().toISOString() }, null, 2));
}

export function markThreatResearchProcessed(fp: string): void {
  saveProcessedFingerprint(fp);
}

export function isFingerprintProcessed(fp: string): boolean {
  return loadProcessedFingerprints().has(fp);
}

export function countProcessedFingerprints(): number {
  return loadProcessedFingerprints().size;
}

type ManifestEntry = AutoCorpusWriteResult &
  AutoCorpusProvenance & {
    timestamp: string;
    toolName: string;
    category: string;
    /** Operator review status for dashboard Pending Review queue */
    status?: 'pending' | 'approved' | 'rejected';
  };

export type AutoCorpusManifestEntry = ManifestEntry;

function loadManifestFile(): { timestamp: string; count: number; entries: ManifestEntry[] } {
  const path = autoCorpusManifestPath();
  if (!existsSync(path)) {
    return { timestamp: new Date().toISOString(), count: 0, entries: [] };
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as {
      timestamp: string;
      count: number;
      entries: ManifestEntry[];
    };
  } catch {
    return { timestamp: new Date().toISOString(), count: 0, entries: [] };
  }
}

function saveManifestFile(manifest: {
  timestamp: string;
  count: number;
  entries: ManifestEntry[];
}): void {
  const path = autoCorpusManifestPath();
  mkdirSync(join(path, '..'), { recursive: true });
  manifest.count = manifest.entries.length;
  manifest.timestamp = new Date().toISOString();
  if (manifest.entries.length > 500) {
    manifest.entries = manifest.entries.slice(-500);
    manifest.count = manifest.entries.length;
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

function appendManifest(entry: ManifestEntry): void {
  const manifest = loadManifestFile();
  manifest.entries.push({ ...entry, status: entry.status || 'pending' });
  saveManifestFile(manifest);
}

/** Set review status on a swarm auto-corpus manifest entry (dashboard Approve/Reject). */
export function setAutoCorpusManifestStatus(
  advId: string,
  status: 'pending' | 'approved' | 'rejected',
): { ok: boolean; error?: string; entry?: ManifestEntry } {
  const id = advId.trim();
  if (!id) return { ok: false, error: 'advId required' };
  const manifest = loadManifestFile();
  const entry = manifest.entries.find((e) => e.advId === id);
  if (!entry) return { ok: false, error: 'Entry not found' };
  entry.status = status;
  saveManifestFile(manifest);
  return { ok: true, entry };
}

/** Approve or reject all pending writer-manifest entries. */
export function setAllPendingAutoCorpusStatus(
  status: 'approved' | 'rejected',
): { ok: boolean; count: number } {
  const manifest = loadManifestFile();
  let count = 0;
  for (const entry of manifest.entries) {
    if (!entry.status || entry.status === 'pending') {
      entry.status = status;
      count++;
    }
  }
  if (count > 0) saveManifestFile(manifest);
  return { ok: true, count };
}

export function writeAutoCorpusFixture(
  discovery: ThreatLabDiscovery,
  provenance: AutoCorpusProvenance,
): AutoCorpusWriteResult | null {
  const fp = candidateFingerprint(discovery);
  if (isFingerprintProcessed(fp)) return null;

  const customDir = customAttacksDir();
  const advId = nextAdvId(customDir);
  const relPath = `adversarial-harness/fixtures/custom-attacks/${advId}.json`;
  const fixture = {
    ...discovery.corpusCandidate,
    id: advId,
    attackClass: discovery.attackClass,
    expectedBlock: true,
    expected: 'block',
    source: 'auto-threat-research',
    autoResearch: {
      source: provenance.source,
      inputFingerprint: provenance.inputFingerprint,
      hypothesis: discovery.hypothesis,
      confidence: discovery.confidence,
      llmUsed: provenance.llmUsed,
    },
  };
  writeFileSync(join(customDir, `${advId}.json`), JSON.stringify(fixture, null, 2));
  saveProcessedFingerprint(fp);
  appendManifest({
    advId,
    relPath,
    fingerprint: fp,
    ...provenance,
    attackClass: discovery.attackClass,
    hypothesis: discovery.hypothesis,
    confidence: discovery.confidence,
    timestamp: new Date().toISOString(),
    toolName: discovery.corpusCandidate.toolName,
    category: discovery.corpusCandidate.category,
  });
  return { advId, relPath, fingerprint: fp };
}

export function readAutoCorpusManifest(): {
  timestamp: string;
  count: number;
  entries: ManifestEntry[];
} | null {
  const path = autoCorpusManifestPath();
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as {
      timestamp: string;
      count: number;
      entries: ManifestEntry[];
    };
    return data;
  } catch {
    return null;
  }
}

/**
 * Novel-lane precision counters — soft-deny skips, noise rejects, promotions by scanner.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ensureVulnStoreDir, vulnPrecisionPath } from './paths.js';

export type PrecisionEventKind =
  | 'soft_deny_skip'
  | 'noise_reject'
  | 'finding_emit'
  | 'promoted'
  | 'disclosed';

export interface PrecisionBucket {
  scanner: string;
  softDenySkip: number;
  noiseReject: number;
  findingEmit: number;
  promoted: number;
  disclosed: number;
}

const buckets = new Map<string, PrecisionBucket>();

function pathOf(): string {
  return vulnPrecisionPath();
}

function mergeBucket(b: PrecisionBucket): void {
  const existing = buckets.get(b.scanner);
  if (!existing) {
    buckets.set(b.scanner, { ...b });
    return;
  }
  existing.softDenySkip = Math.max(existing.softDenySkip, b.softDenySkip);
  existing.noiseReject = Math.max(existing.noiseReject, b.noiseReject);
  existing.findingEmit = Math.max(existing.findingEmit, b.findingEmit);
  existing.promoted = Math.max(existing.promoted, b.promoted);
  existing.disclosed = Math.max(existing.disclosed, b.disclosed);
}

function loadFromDisk(): void {
  try {
    const p = pathOf();
    if (!existsSync(p)) return;
    const raw = JSON.parse(readFileSync(p, 'utf8')) as PrecisionBucket[];
    if (Array.isArray(raw)) {
      for (const b of raw) mergeBucket(b);
    }
  } catch {
    /* ignore */
  }
}

function ensureLoaded(): void {
  if (buckets.size > 0) return;
  loadFromDisk();
}

function persist(): void {
  try {
    ensureVulnStoreDir();
    loadFromDisk();
    writeFileSync(pathOf(), JSON.stringify([...buckets.values()], null, 2));
  } catch {
    /* best-effort */
  }
}

function bucket(scanner: string): PrecisionBucket {
  ensureLoaded();
  let b = buckets.get(scanner);
  if (!b) {
    b = {
      scanner,
      softDenySkip: 0,
      noiseReject: 0,
      findingEmit: 0,
      promoted: 0,
      disclosed: 0,
    };
    buckets.set(scanner, b);
  }
  return b;
}

export function recordPrecisionEvent(
  scanner: string,
  kind: PrecisionEventKind,
): void {
  const b = bucket(scanner || 'unknown');
  if (kind === 'soft_deny_skip') b.softDenySkip++;
  else if (kind === 'noise_reject') b.noiseReject++;
  else if (kind === 'finding_emit') b.findingEmit++;
  else if (kind === 'promoted') b.promoted++;
  else if (kind === 'disclosed') b.disclosed++;
  persist();
}

export function getPrecisionMetrics(): PrecisionBucket[] {
  loadFromDisk();
  return [...buckets.values()].sort((a, b) => a.scanner.localeCompare(b.scanner));
}

export function novelPrecisionSummary(): {
  softDenySkip: number;
  noiseReject: number;
  findingEmit: number;
  promoted: number;
  byScanner: PrecisionBucket[];
} {
  const rows = getPrecisionMetrics();
  return {
    softDenySkip: rows.reduce((s, r) => s + r.softDenySkip, 0),
    noiseReject: rows.reduce((s, r) => s + r.noiseReject, 0),
    findingEmit: rows.reduce((s, r) => s + r.findingEmit, 0),
    promoted: rows.reduce((s, r) => s + r.promoted, 0),
    byScanner: rows,
  };
}

export function resetPrecisionMetricsForTests(): void {
  buckets.clear();
}

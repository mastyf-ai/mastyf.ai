/**
 * Persist VulnFinding records to {vulnStore}/vuln-findings.jsonl
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import type { VulnFinding, VulnSeverity, VulnStatus } from './types.js';
import { ensureVulnStoreDir, vulnFindingsPath } from './paths.js';

function findingsPath(): string {
  return vulnFindingsPath();
}

function ensureDir(): void {
  ensureVulnStoreDir();
}

export function fingerprintFinding(partial: {
  class: string;
  target: { kind: string; name: string; version?: string; url?: string };
  title: string;
  evidence: { scanner: string; reproSteps: string[] };
}): string {
  const key = [
    partial.class,
    partial.target.kind,
    partial.target.name,
    partial.target.version || '',
    partial.target.url || '',
    partial.title,
    partial.evidence.scanner,
    partial.evidence.reproSteps.slice(0, 3).join('|'),
  ].join('::');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

export function createFindingId(fingerprint: string): string {
  return `vuln-${fingerprint.slice(0, 16)}`;
}

export function loadFindings(): VulnFinding[] {
  ensureDir();
  const path = findingsPath();
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const byId = new Map<string, VulnFinding>();
  for (const line of lines) {
    try {
      const f = JSON.parse(line) as VulnFinding;
      byId.set(f.id, f); // last write wins (updates)
    } catch {
      /* skip corrupt */
    }
  }
  return [...byId.values()];
}

export function getFinding(id: string): VulnFinding | undefined {
  return loadFindings().find((f) => f.id === id);
}

export function upsertFinding(finding: VulnFinding): VulnFinding {
  ensureDir();
  appendFileSync(findingsPath(), JSON.stringify(finding) + '\n');
  return finding;
}

export function updateFindingStatus(
  id: string,
  status: VulnStatus,
  extra?: Partial<VulnFinding>,
): VulnFinding | undefined {
  const existing = getFinding(id);
  if (!existing) return undefined;
  const updated: VulnFinding = {
    ...existing,
    ...extra,
    status,
    validatedAt:
      status === 'validated'
        ? extra?.validatedAt || new Date().toISOString()
        : existing.validatedAt,
  };
  upsertFinding(updated);
  return updated;
}

export function listFindings(opts?: {
  status?: VulnStatus;
  minSeverity?: VulnSeverity;
  class?: string;
}): VulnFinding[] {
  const order: VulnSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  let all = loadFindings();
  if (opts?.status) all = all.filter((f) => f.status === opts.status);
  if (opts?.class) all = all.filter((f) => f.class === opts.class);
  if (opts?.minSeverity) {
    const minIdx = order.indexOf(opts.minSeverity);
    all = all.filter((f) => order.indexOf(f.severity) <= minIdx);
  }
  return all.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

/** Compact store by rewriting unique latest records (maintenance). */
export function compactFindingsStore(): number {
  const all = loadFindings();
  ensureDir();
  const tmp = findingsPath() + '.tmp';
  writeFileSync(tmp, all.map((f) => JSON.stringify(f)).join('\n') + (all.length ? '\n' : ''));
  renameSync(tmp, findingsPath());
  return all.length;
}

/**
 * Shared vuln-discovery store root.
 * Priority: MASTYF_AI_VULN_STORE_DIR → MASTYF_AI_HOME → ~/.mastyf-ai
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';

/** Absolute directory for findings, stats, precision, reports, disclosure packages. */
export function getVulnStoreDir(): string {
  const explicit = process.env.MASTYF_AI_VULN_STORE_DIR?.trim();
  if (explicit) return explicit;
  const home = process.env.MASTYF_AI_HOME?.trim();
  if (home) return home;
  return join(homedir(), '.mastyf-ai');
}

export function ensureVulnStoreDir(): string {
  const d = getVulnStoreDir();
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export function vulnFindingsPath(): string {
  return join(getVulnStoreDir(), 'vuln-findings.jsonl');
}

export function vulnLiveStatsPath(): string {
  return join(getVulnStoreDir(), 'vuln-live-traffic-stats.json');
}

export function vulnPrecisionPath(): string {
  return join(getVulnStoreDir(), 'vuln-precision-metrics.json');
}

export function vulnReportsDir(): string {
  return join(getVulnStoreDir(), 'vuln-reports');
}

export function vulnDisclosureDir(findingId?: string): string {
  const base = join(getVulnStoreDir(), 'vuln-disclosure');
  return findingId ? join(base, findingId) : base;
}

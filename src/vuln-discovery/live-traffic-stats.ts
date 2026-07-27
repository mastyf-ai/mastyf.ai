/**
 * Live traffic hotness counters — prioritize fuzz coverage for tools under attack.
 * Persisted under shared vuln store; API reads always merge from disk (fleet children).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ensureVulnStoreDir, vulnLiveStatsPath } from './paths.js';

export interface LiveTrafficStat {
  key: string;
  serverName: string;
  toolName: string;
  allowCount: number;
  maliciousShapedCount: number;
  softDenyCount: number;
  lastSeenAt: string;
}

const stats = new Map<string, LiveTrafficStat>();
const MAX_KEYS = 500;

function statsPath(): string {
  return vulnLiveStatsPath();
}

function keyOf(serverName: string, toolName: string): string {
  return `${serverName}:${toolName}`;
}

/** Merge a disk row into memory (take max counters / latest timestamp). */
function mergeRow(row: LiveTrafficStat): void {
  const existing = stats.get(row.key);
  if (!existing) {
    stats.set(row.key, { ...row });
    return;
  }
  existing.allowCount = Math.max(existing.allowCount, row.allowCount);
  existing.maliciousShapedCount = Math.max(
    existing.maliciousShapedCount,
    row.maliciousShapedCount,
  );
  existing.softDenyCount = Math.max(existing.softDenyCount, row.softDenyCount);
  if (row.lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = row.lastSeenAt;
}

function loadFromDisk(): void {
  try {
    const p = statsPath();
    if (!existsSync(p)) return;
    const raw = JSON.parse(readFileSync(p, 'utf8')) as LiveTrafficStat[];
    if (Array.isArray(raw)) {
      for (const row of raw.slice(-MAX_KEYS)) {
        mergeRow(row);
      }
    }
  } catch {
    /* ignore */
  }
}

function ensureLoaded(): void {
  if (stats.size > 0) return;
  loadFromDisk();
}

/** Force re-merge from disk so dashboard sees fleet child writes. */
export function reloadLiveTrafficStatsFromDisk(): void {
  loadFromDisk();
}

function persist(): void {
  try {
    ensureVulnStoreDir();
    // Reload peer writes before overwrite
    loadFromDisk();
    writeFileSync(statsPath(), JSON.stringify([...stats.values()], null, 2));
  } catch {
    /* best-effort */
  }
}

function bump(
  serverName: string,
  toolName: string,
  field: 'allowCount' | 'maliciousShapedCount' | 'softDenyCount',
): void {
  ensureLoaded();
  const key = keyOf(serverName, toolName);
  let row = stats.get(key);
  if (!row) {
    if (stats.size >= MAX_KEYS) {
      const oldest = [...stats.values()].sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))[0];
      if (oldest) stats.delete(oldest.key);
    }
    row = {
      key,
      serverName,
      toolName,
      allowCount: 0,
      maliciousShapedCount: 0,
      softDenyCount: 0,
      lastSeenAt: new Date().toISOString(),
    };
    stats.set(key, row);
  }
  row[field]++;
  row.lastSeenAt = new Date().toISOString();
  persist();
}

export function recordLiveAllow(serverName: string, toolName: string): void {
  bump(serverName, toolName, 'allowCount');
}

export function recordMaliciousShaped(serverName: string, toolName: string): void {
  bump(serverName, toolName, 'maliciousShapedCount');
}

export function recordSoftDenySeen(serverName: string, toolName: string): void {
  bump(serverName, toolName, 'softDenyCount');
}

export function getLiveTrafficStats(): LiveTrafficStat[] {
  reloadLiveTrafficStatsFromDisk();
  return [...stats.values()].sort(
    (a, b) =>
      b.maliciousShapedCount - a.maliciousShapedCount
      || b.allowCount - a.allowCount,
  );
}

export function hotnessScore(serverName: string, toolName: string): number {
  reloadLiveTrafficStatsFromDisk();
  const row = stats.get(keyOf(serverName, toolName));
  if (!row) return 0;
  return row.maliciousShapedCount * 10 + row.allowCount + row.softDenyCount * 2;
}

/** Sort tools so hottest (for this server) come first. */
export function sortToolsByLiveHotness<T extends { name: string }>(
  serverName: string,
  tools: T[],
): T[] {
  return [...tools].sort(
    (a, b) => hotnessScore(serverName, b.name) - hotnessScore(serverName, a.name),
  );
}

export function resetLiveTrafficStatsForTests(): void {
  stats.clear();
}

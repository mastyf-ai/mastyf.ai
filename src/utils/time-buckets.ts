/**
 * Time bucket generation and zero-fill for honest dashboard charts.
 */
import type { ProxyCallRecord } from '../types.js';

export type DashboardWindow = '1h' | '12h' | '24h' | '7d' | '30d' | '90d';

export type BucketGranularity = 'hour' | 'day';

/**
 * Parse a window descriptor into days (fractional allowed for sub-day windows).
 *
 * Accepted forms (case-insensitive):
 *   - Label: '1h', '12h', '24h', '7d', '30d', '90d'
 *   - Days (integer or fractional): '7', '0.5', '0.0416' (1h)
 *   - number: 7, 0.5, 1/24
 *
 * Always returns a finite number in the inclusive range [1/24, 90].
 */
export function parseWindowDays(window: string | number | undefined, fallback = 7): number {
  const clamp = (n: number): number => Math.min(90, Math.max(1 / 24, n));

  if (typeof window === 'number' && Number.isFinite(window) && window > 0) {
    return clamp(window);
  }
  const raw = String(window ?? '').trim();
  if (!raw) return fallback;

  // Label form: '1h', '12h', '24h', '7d', '30d', '90d'
  const h = raw.match(/^(\d+(?:\.\d+)?)h$/i);
  if (h) {
    const hours = parseFloat(h[1]);
    if (Number.isFinite(hours) && hours > 0) return clamp(hours / 24);
  }
  const d = raw.match(/^(\d+(?:\.\d+)?)d$/i);
  if (d) {
    const days = parseFloat(d[1]);
    if (Number.isFinite(days) && days > 0) return clamp(days);
  }

  // Bare numeric: 7, 0.5, 0.0416 — fractional is honored
  const n = parseFloat(raw);
  if (Number.isFinite(n) && n > 0) return clamp(n);
  return fallback;
}

export function windowToLabel(days: number): DashboardWindow {
  if (days <= 1 / 24) return '1h';
  if (days <= 12 / 24) return '12h';
  if (days <= 1) return '24h';
  if (days <= 7) return '7d';
  if (days <= 30) return '30d';
  return '90d';
}

/** Parse call_records.created_at — SQLite stores UTC without a Z suffix. */
export function parseRecordTimestamp(raw: string | undefined | null): number {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s);
  if (s.includes('T')) return Date.parse(s);
  return Date.parse(s.replace(' ', 'T') + 'Z');
}

export function windowRangeMs(windowDays: number, nowMs = Date.now()): {
  startMs: number;
  endMs: number;
  priorStartMs: number;
  priorEndMs: number;
} {
  const endMs = nowMs;
  const startMs = endMs - windowDays * 86_400_000;
  const priorEndMs = startMs;
  const priorStartMs = priorEndMs - windowDays * 86_400_000;
  return { startMs, endMs, priorStartMs, priorEndMs };
}

/** Filter proxy call records to an inclusive time window using SQLite-safe UTC parsing. */
export function filterRecordsInWindow(
  records: ProxyCallRecord[],
  startMs: number,
  endMs: number,
): ProxyCallRecord[] {
  return records.filter((r) => {
    const ts = parseRecordTimestamp(r.timestamp);
    return Number.isFinite(ts) && ts >= startMs && ts <= endMs;
  });
}

/** Filter by window length ending at now (or optional endMs). */
export function filterRecordsByWindowDays(
  records: ProxyCallRecord[],
  windowDaysInput: string | number,
  nowMs = Date.now(),
): ProxyCallRecord[] {
  const windowDays = parseWindowDays(windowDaysInput);
  const { startMs, endMs } = windowRangeMs(windowDays, nowMs);
  return filterRecordsInWindow(records, startMs, endMs);
}

function hourBucketIso(ts: number): string {
  const d = new Date(ts);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function dayBucketIso(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function generateTimeBuckets(
  startMs: number,
  endMs: number,
  granularity: BucketGranularity,
): string[] {
  const buckets: string[] = [];
  const step = granularity === 'hour' ? 3_600_000 : 86_400_000;
  const align = (ts: number) => {
    const d = new Date(ts);
    if (granularity === 'hour') {
      d.setUTCMinutes(0, 0, 0);
    } else {
      d.setUTCHours(0, 0, 0, 0);
    }
    return d.getTime();
  };
  let cursor = align(startMs);
  const limit = align(endMs);
  while (cursor <= limit) {
    buckets.push(granularity === 'hour' ? hourBucketIso(cursor) : dayBucketIso(cursor));
    cursor += step;
  }
  return buckets;
}

export function bucketGranularityForWindow(windowDays: number): BucketGranularity {
  return windowDays <= 7 ? 'hour' : 'day';
}

export type FillTimeSeriesResult<T> = {
  points: T[];
  sparse: boolean;
  zeroBucketRatio: number;
  totalValue: number;
};

export function fillTimeSeries<T extends Record<string, unknown>>(
  rawPoints: T[],
  bucketKey: keyof T,
  buckets: string[],
  valueKeys: (keyof T)[],
  defaults: Partial<T> = {},
): FillTimeSeriesResult<T> {
  const byBucket = new Map<string, T>();
  for (const p of rawPoints) {
    const key = String(p[bucketKey] ?? '');
    if (!key) continue;
    byBucket.set(key, p);
  }

  let zeroBuckets = 0;
  let totalValue = 0;
  const points = buckets.map((bucket) => {
    const existing = byBucket.get(bucket);
    if (existing) {
      for (const vk of valueKeys) {
        totalValue += Number(existing[vk]) || 0;
      }
      return existing;
    }
    zeroBuckets++;
    const row = { ...defaults, [bucketKey]: bucket } as T;
    for (const vk of valueKeys) {
      (row as Record<string, unknown>)[String(vk)] = 0;
    }
    return row;
  });

  const zeroBucketRatio = buckets.length > 0 ? zeroBuckets / buckets.length : 0;
  const sparse = zeroBucketRatio > 0.5 && totalValue > 0;

  return { points, sparse, zeroBucketRatio, totalValue };
}

export function computeComparison(
  current: number,
  prior: number,
): { deltaPct: number | null; deltaAbs: number; direction: 'up' | 'down' | 'flat' } {
  const deltaAbs = current - prior;
  if (prior === 0 && current === 0) {
    return { deltaPct: null, deltaAbs: 0, direction: 'flat' };
  }
  const deltaPct = prior === 0 ? null : Math.round((deltaAbs / prior) * 1000) / 10;
  const direction = Math.abs(deltaAbs) < 0.0001 ? 'flat' : deltaAbs > 0 ? 'up' : 'down';
  return { deltaPct, deltaAbs, direction };
}

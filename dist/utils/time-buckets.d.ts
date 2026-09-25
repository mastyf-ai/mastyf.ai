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
export declare function parseWindowDays(window: string | number | undefined, fallback?: number): number;
export declare function windowToLabel(days: number): DashboardWindow;
/** Parse call_records.created_at — SQLite stores UTC without a Z suffix. */
export declare function parseRecordTimestamp(raw: string | undefined | null): number;
export declare function windowRangeMs(windowDays: number, nowMs?: number): {
    startMs: number;
    endMs: number;
    priorStartMs: number;
    priorEndMs: number;
};
/** Filter proxy call records to an inclusive time window using SQLite-safe UTC parsing. */
export declare function filterRecordsInWindow(records: ProxyCallRecord[], startMs: number, endMs: number): ProxyCallRecord[];
/** Filter by window length ending at now (or optional endMs). */
export declare function filterRecordsByWindowDays(records: ProxyCallRecord[], windowDaysInput: string | number, nowMs?: number): ProxyCallRecord[];
export declare function generateTimeBuckets(startMs: number, endMs: number, granularity: BucketGranularity): string[];
export declare function bucketGranularityForWindow(windowDays: number): BucketGranularity;
export type FillTimeSeriesResult<T> = {
    points: T[];
    sparse: boolean;
    zeroBucketRatio: number;
    totalValue: number;
};
export declare function fillTimeSeries<T extends Record<string, unknown>>(rawPoints: T[], bucketKey: keyof T, buckets: string[], valueKeys: (keyof T)[], defaults?: Partial<T>): FillTimeSeriesResult<T>;
export declare function computeComparison(current: number, prior: number): {
    deltaPct: number | null;
    deltaAbs: number;
    direction: 'up' | 'down' | 'flat';
};
//# sourceMappingURL=time-buckets.d.ts.map
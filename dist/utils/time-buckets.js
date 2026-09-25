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
export function parseWindowDays(window, fallback = 7) {
    const clamp = (n) => Math.min(90, Math.max(1 / 24, n));
    if (typeof window === 'number' && Number.isFinite(window) && window > 0) {
        return clamp(window);
    }
    const raw = String(window ?? '').trim();
    if (!raw)
        return fallback;
    // Label form: '1h', '12h', '24h', '7d', '30d', '90d'
    const h = raw.match(/^(\d+(?:\.\d+)?)h$/i);
    if (h) {
        const hours = parseFloat(h[1]);
        if (Number.isFinite(hours) && hours > 0)
            return clamp(hours / 24);
    }
    const d = raw.match(/^(\d+(?:\.\d+)?)d$/i);
    if (d) {
        const days = parseFloat(d[1]);
        if (Number.isFinite(days) && days > 0)
            return clamp(days);
    }
    // Bare numeric: 7, 0.5, 0.0416 — fractional is honored
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > 0)
        return clamp(n);
    return fallback;
}
export function windowToLabel(days) {
    if (days <= 1 / 24)
        return '1h';
    if (days <= 12 / 24)
        return '12h';
    if (days <= 1)
        return '24h';
    if (days <= 7)
        return '7d';
    if (days <= 30)
        return '30d';
    return '90d';
}
/** Parse call_records.created_at — SQLite stores UTC without a Z suffix. */
export function parseRecordTimestamp(raw) {
    const s = String(raw ?? '').trim();
    if (!s)
        return NaN;
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s))
        return Date.parse(s);
    if (s.includes('T'))
        return Date.parse(s);
    return Date.parse(s.replace(' ', 'T') + 'Z');
}
export function windowRangeMs(windowDays, nowMs = Date.now()) {
    const endMs = nowMs;
    const startMs = endMs - windowDays * 86_400_000;
    const priorEndMs = startMs;
    const priorStartMs = priorEndMs - windowDays * 86_400_000;
    return { startMs, endMs, priorStartMs, priorEndMs };
}
/** Filter proxy call records to an inclusive time window using SQLite-safe UTC parsing. */
export function filterRecordsInWindow(records, startMs, endMs) {
    return records.filter((r) => {
        const ts = parseRecordTimestamp(r.timestamp);
        return Number.isFinite(ts) && ts >= startMs && ts <= endMs;
    });
}
/** Filter by window length ending at now (or optional endMs). */
export function filterRecordsByWindowDays(records, windowDaysInput, nowMs = Date.now()) {
    const windowDays = parseWindowDays(windowDaysInput);
    const { startMs, endMs } = windowRangeMs(windowDays, nowMs);
    return filterRecordsInWindow(records, startMs, endMs);
}
function hourBucketIso(ts) {
    const d = new Date(ts);
    d.setUTCMinutes(0, 0, 0);
    return d.toISOString();
}
function dayBucketIso(ts) {
    return new Date(ts).toISOString().slice(0, 10);
}
export function generateTimeBuckets(startMs, endMs, granularity) {
    const buckets = [];
    const step = granularity === 'hour' ? 3_600_000 : 86_400_000;
    const align = (ts) => {
        const d = new Date(ts);
        if (granularity === 'hour') {
            d.setUTCMinutes(0, 0, 0);
        }
        else {
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
export function bucketGranularityForWindow(windowDays) {
    return windowDays <= 7 ? 'hour' : 'day';
}
export function fillTimeSeries(rawPoints, bucketKey, buckets, valueKeys, defaults = {}) {
    const byBucket = new Map();
    for (const p of rawPoints) {
        const key = String(p[bucketKey] ?? '');
        if (!key)
            continue;
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
        const row = { ...defaults, [bucketKey]: bucket };
        for (const vk of valueKeys) {
            row[String(vk)] = 0;
        }
        return row;
    });
    const zeroBucketRatio = buckets.length > 0 ? zeroBuckets / buckets.length : 0;
    const sparse = zeroBucketRatio > 0.5 && totalValue > 0;
    return { points, sparse, zeroBucketRatio, totalValue };
}
export function computeComparison(current, prior) {
    const deltaAbs = current - prior;
    if (prior === 0 && current === 0) {
        return { deltaPct: null, deltaAbs: 0, direction: 'flat' };
    }
    const deltaPct = prior === 0 ? null : Math.round((deltaAbs / prior) * 1000) / 10;
    const direction = Math.abs(deltaAbs) < 0.0001 ? 'flat' : deltaAbs > 0 ? 'up' : 'down';
    return { deltaPct, deltaAbs, direction };
}
//# sourceMappingURL=time-buckets.js.map
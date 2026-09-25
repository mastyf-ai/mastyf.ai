import { getAllActiveServerNames } from './db-aggregate.js';
import { buildChartMeta } from './chart-meta.js';
import { bucketGranularityForWindow, computeComparison, fillTimeSeries, generateTimeBuckets, parseRecordTimestamp, parseWindowDays, windowRangeMs, } from './time-buckets.js';
function bucketKey(ts, granularity) {
    const d = new Date(ts);
    if (granularity === 'hour') {
        return d.toISOString().slice(0, 13) + ':00:00.000Z';
    }
    return d.toISOString().slice(0, 10);
}
const TOP_SERVERS = 5;
export async function buildCostTimeseries(db, tenantId, windowDaysInput, granularityInput) {
    const windowDays = parseWindowDays(windowDaysInput);
    const granularity = granularityInput ?? bucketGranularityForWindow(windowDays);
    const { startMs, endMs, priorStartMs, priorEndMs } = windowRangeMs(windowDays);
    const srvs = await getAllActiveServerNames(db, tenantId);
    const byBucket = new Map();
    const byServer = new Map();
    let priorCost = 0;
    let recordCount = 0;
    for (const srv of srvs) {
        const recs = await db.getCallRecordsForServer(srv, undefined, tenantId);
        for (const r of recs) {
            const ts = parseRecordTimestamp(r.timestamp);
            if (!Number.isFinite(ts))
                continue;
            const cost = Number(r.costUsd) || 0;
            if (ts >= priorStartMs && ts < priorEndMs) {
                priorCost += cost;
            }
            if (ts < startMs || ts > endMs)
                continue;
            recordCount++;
            const bucket = bucketKey(ts, granularity);
            const key = `${bucket}|${srv}`;
            const cur = byBucket.get(key) || { bucket, server: srv, costUsd: 0, calls: 0 };
            cur.calls++;
            cur.costUsd += cost;
            byBucket.set(key, cur);
            const srvCur = byServer.get(srv) || { costUsd: 0, calls: 0 };
            srvCur.calls++;
            srvCur.costUsd += cost;
            byServer.set(srv, srvCur);
        }
    }
    const totalsByServer = [...byServer.entries()]
        .map(([server, v]) => ({ server, ...v }))
        .sort((a, b) => b.costUsd - a.costUsd);
    const topServerNames = new Set(totalsByServer.slice(0, TOP_SERVERS).map((s) => s.server));
    const buckets = generateTimeBuckets(startMs, endMs, granularity);
    const bucketTotals = new Map();
    for (const p of byBucket.values()) {
        bucketTotals.set(p.bucket, (bucketTotals.get(p.bucket) || 0) + p.costUsd);
    }
    const sparseCheck = fillTimeSeries([...bucketTotals.entries()].map(([bucket, total]) => ({ bucket, total })), 'bucket', buckets, ['total']);
    const series = [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
    const pivoted = pivotCostTimeseries(series, topServerNames, buckets);
    const currentTotal = totalsByServer.reduce((s, r) => s + r.costUsd, 0);
    const meta = buildChartMeta({
        windowDays,
        recordCount,
        sparse: sparseCheck.sparse,
        dataSources: ['history.db'],
        emptyReason: recordCount === 0 ? 'No priced calls in selected window' : undefined,
    });
    return {
        windowDays,
        granularity,
        series,
        totalsByServer,
        pivoted,
        meta,
        comparison: {
            totalCostUsd: computeComparison(currentTotal, priorCost),
        },
    };
}
/** Pivot series into stacked chart rows keyed by bucket with top-N + Other. */
export function pivotCostTimeseries(series, topServers, buckets) {
    const bucketMap = new Map();
    for (const p of series) {
        const serverKey = topServers && !topServers.has(p.server) ? 'Other' : p.server;
        const row = bucketMap.get(p.bucket) || { total: 0 };
        row[serverKey] = (row[serverKey] || 0) + p.costUsd;
        row.total += p.costUsd;
        bucketMap.set(p.bucket, row);
    }
    const orderedBuckets = buckets ?? [...bucketMap.keys()].sort();
    return orderedBuckets.map((bucket) => {
        const vals = bucketMap.get(bucket) ?? { total: 0 };
        return { bucket, ...vals };
    });
}
export async function loadAllRecordsInWindow(db, tenantId, windowDays) {
    const { startMs, endMs } = windowRangeMs(parseWindowDays(windowDays));
    const srvs = await getAllActiveServerNames(db, tenantId);
    const all = [];
    for (const srv of srvs) {
        const recs = await db.getCallRecordsForServer(srv, undefined, tenantId);
        for (const r of recs) {
            const ts = parseRecordTimestamp(r.timestamp);
            if (Number.isFinite(ts) && ts >= startMs && ts <= endMs)
                all.push(r);
        }
    }
    return all;
}
//# sourceMappingURL=cost-timeseries.js.map
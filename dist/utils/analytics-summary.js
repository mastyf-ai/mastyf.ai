import { detectProvider } from './token-counter.js';
import { summarizeRecords } from './db-aggregate.js';
import { loadAllRecordsInWindow } from './cost-timeseries.js';
import { buildChartMeta } from './chart-meta.js';
import { bucketGranularityForWindow, fillTimeSeries, generateTimeBuckets, parseRecordTimestamp, parseWindowDays, windowRangeMs, } from './time-buckets.js';
import { parseCostBudgetUsd } from './dashboard-live-data.js';
const PROVIDER_LABELS = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google AI',
    unknown: 'Other',
};
const PROVIDER_COLOR = {
    openai: 'openai',
    anthropic: 'anthropic',
    google: 'google',
    unknown: 'other',
};
function friendlyModelLabel(modelId) {
    const m = modelId.toLowerCase();
    if (m.includes('gpt-4o') || m.includes('gpt-4'))
        return 'GPT-4o';
    if (m.includes('claude-3.5') || m.includes('claude-3'))
        return 'Claude 3.5';
    if (m.includes('claude'))
        return 'Claude';
    if (m.includes('gemini'))
        return 'Gemini Pro';
    if (m.includes('gpt'))
        return 'GPT';
    return modelId.length > 24 ? `${modelId.slice(0, 22)}…` : modelId;
}
function bucketKey(ts, granularity) {
    const d = new Date(ts);
    if (granularity === 'hour')
        return d.toISOString().slice(0, 13) + ':00:00.000Z';
    return d.toISOString().slice(0, 10);
}
function dayLabel(isoDay) {
    const d = new Date(isoDay + 'T12:00:00.000Z');
    return d.toLocaleDateString('en-US', { weekday: 'short' });
}
function buildTrafficSeries(records, sinceMs, endMs, granularity) {
    const buckets = generateTimeBuckets(sinceMs, endMs, granularity);
    const rawMap = new Map();
    for (const r of records) {
        const ts = parseRecordTimestamp(r.timestamp);
        if (!Number.isFinite(ts) || ts < sinceMs || ts > endMs)
            continue;
        const key = bucketKey(ts, granularity);
        const cur = rawMap.get(key) || { requests: 0, blocked: 0 };
        cur.requests++;
        if (r.blocked)
            cur.blocked++;
        rawMap.set(key, cur);
    }
    const raw = buckets.map((b) => {
        const cur = rawMap.get(b) || { requests: 0, blocked: 0 };
        return { bucket: b, requests: cur.requests, blocked: cur.blocked };
    });
    const filled = fillTimeSeries(raw, 'bucket', buckets, ['requests', 'blocked']);
    return filled.points.map((p) => ({
        bucket: String(p.bucket),
        requests: Number(p.requests) || 0,
        blocked: Number(p.blocked) || 0,
    }));
}
function percentile(sorted, p) {
    if (!sorted.length)
        return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
}
function buildLatencySeries(records, sinceMs, endMs, granularity) {
    const buckets = generateTimeBuckets(sinceMs, endMs, granularity);
    const latencies = new Map();
    for (const r of records) {
        const ts = parseRecordTimestamp(r.timestamp);
        if (!Number.isFinite(ts) || ts < sinceMs || ts > endMs)
            continue;
        const key = bucketKey(ts, granularity);
        const list = latencies.get(key) ?? [];
        const ms = Number(r.durationMs);
        if (Number.isFinite(ms) && ms >= 0)
            list.push(ms);
        latencies.set(key, list);
    }
    return buckets.map((b) => {
        const sorted = [...(latencies.get(b) ?? [])].sort((a, c) => a - c);
        return {
            bucket: b,
            p50Ms: percentile(sorted, 50),
            p95Ms: percentile(sorted, 95),
        };
    });
}
function buildErrorRateSeries(records, sinceMs, endMs, granularity) {
    const traffic = buildTrafficSeries(records, sinceMs, endMs, granularity);
    return traffic.map((p) => ({
        bucket: p.bucket,
        requests: p.requests,
        blocked: p.blocked,
        errorRatePct: p.requests > 0 ? Math.round((p.blocked / p.requests) * 1000) / 10 : 0,
    }));
}
function buildCostSeries(records, sinceMs, endMs) {
    const buckets = generateTimeBuckets(sinceMs, endMs, 'day');
    const rawMap = new Map();
    for (const r of records) {
        const ts = parseRecordTimestamp(r.timestamp);
        if (!Number.isFinite(ts) || ts < sinceMs || ts > endMs)
            continue;
        const key = bucketKey(ts, 'day');
        rawMap.set(key, (rawMap.get(key) || 0) + (Number(r.costUsd) || 0));
    }
    return buckets.map((b) => {
        const costUsd = Math.round((rawMap.get(b) || 0) * 100) / 100;
        return { bucket: b, costUsd, label: dayLabel(b.slice(0, 10)) };
    });
}
function aggregateModelUsage(records) {
    const byModel = new Map();
    let totalTokens = 0;
    for (const r of records) {
        const model = (r.model || 'unknown').trim() || 'unknown';
        const tokens = (r.requestTokens || 0) + (r.responseTokens || 0) || (r.totalTokens || 0);
        const cur = byModel.get(model) || { calls: 0, tokens: 0 };
        cur.calls++;
        cur.tokens += tokens;
        byModel.set(model, cur);
        totalTokens += tokens;
    }
    const denom = totalTokens > 0 ? totalTokens : records.length || 1;
    const sorted = [...byModel.entries()]
        .map(([model, v]) => ({
        model,
        label: friendlyModelLabel(model),
        calls: v.calls,
        tokens: v.tokens,
        pct: Math.round((totalTokens > 0 ? v.tokens / denom : v.calls / denom) * 1000) / 10,
    }))
        .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls);
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6);
    if (rest.length) {
        const otherCalls = rest.reduce((s, x) => s + x.calls, 0);
        const otherTokens = rest.reduce((s, x) => s + x.tokens, 0);
        const otherPct = Math.round((totalTokens > 0 ? otherTokens / denom : otherCalls / denom) * 1000) / 10;
        top.push({
            model: 'other',
            label: 'Other',
            calls: otherCalls,
            tokens: otherTokens,
            pct: otherPct,
        });
    }
    return top;
}
function aggregateProviderCosts(records) {
    const byProvider = new Map();
    for (const r of records) {
        const model = (r.model || '').trim();
        const provider = model ? detectProvider(model) : 'unknown';
        byProvider.set(provider, (byProvider.get(provider) || 0) + (Number(r.costUsd) || 0));
    }
    return ['openai', 'anthropic', 'google', 'unknown']
        .map((provider) => ({
        provider,
        label: PROVIDER_LABELS[provider],
        costUsd: Math.round((byProvider.get(provider) || 0) * 100) / 100,
        colorKey: PROVIDER_COLOR[provider],
    }))
        .filter((p) => p.costUsd > 0 || records.some((r) => detectProvider(r.model || '') === p.provider))
        .sort((a, b) => b.costUsd - a.costUsd);
}
export async function buildAnalyticsSummary(db, tenantId, windowDaysInput) {
    const windowDays = parseWindowDays(windowDaysInput);
    const { startMs, endMs } = windowRangeMs(windowDays);
    const granularity = bucketGranularityForWindow(windowDays);
    const empty = {
        available: false,
        windowDays,
        generatedAt: new Date().toISOString(),
        totalRequests: 0,
        avgLatencyMs: 0,
        errorRatePct: 0,
        tokensUsed: 0,
        budgetUsd: parseCostBudgetUsd(),
        budgetUtilizationPct: null,
        trafficSeries: [],
        latencySeries: [],
        errorRateSeries: [],
        costSeries: [],
        modelUsage: [],
        providerCosts: [],
        meta: buildChartMeta({
            windowDays,
            recordCount: 0,
            sparse: true,
            dataSources: [],
            emptyReason: 'No history database — start proxy with MASTYF_AI_DB_PATH',
        }),
        emptyReason: 'No history database — start proxy with MASTYF_AI_DB_PATH',
    };
    if (!db)
        return empty;
    const records = await loadAllRecordsInWindow(db, tenantId, windowDays);
    if (!records.length) {
        return {
            ...empty,
            available: true,
            emptyReason: 'No proxy traffic in the selected window — use MCP tools through Mastyf AI',
            meta: buildChartMeta({
                windowDays,
                recordCount: 0,
                sparse: true,
                dataSources: ['history.db'],
                emptyReason: 'No proxy traffic in the selected window — use MCP tools through Mastyf AI',
            }),
        };
    }
    const sum = summarizeRecords(records);
    const tokensUsed = sum.totalInput + sum.totalOutput;
    const avgLatencyMs = sum.total > 0 ? Math.round(sum.totalLatency / sum.total) : 0;
    const errorRatePct = sum.total > 0 ? Math.round((sum.blocked / sum.total) * 1000) / 10 : 0;
    const budgetUsd = parseCostBudgetUsd();
    const budgetUtilizationPct = budgetUsd != null && budgetUsd > 0
        ? Math.min(100, Math.round((sum.costUsd / budgetUsd) * 1000) / 10)
        : null;
    return {
        available: true,
        windowDays,
        generatedAt: new Date().toISOString(),
        totalRequests: sum.total,
        avgLatencyMs,
        errorRatePct,
        tokensUsed,
        budgetUsd,
        budgetUtilizationPct,
        trafficSeries: buildTrafficSeries(records, startMs, endMs, granularity),
        latencySeries: buildLatencySeries(records, startMs, endMs, granularity),
        errorRateSeries: buildErrorRateSeries(records, startMs, endMs, granularity),
        costSeries: buildCostSeries(records, startMs, endMs),
        modelUsage: aggregateModelUsage(records),
        providerCosts: aggregateProviderCosts(records),
        meta: buildChartMeta({
            windowDays,
            recordCount: records.length,
            sparse: records.length < 5,
            dataSources: ['history.db'],
        }),
    };
}
//# sourceMappingURL=analytics-summary.js.map
import { summarizeRecords } from './db-aggregate.js';
import { getRuntimeModelPricing } from '../services/runtime-model-pricing.js';
import { resolveModelIdForServer } from '../config/llm-config.js';
const COVERAGE_DISCLAIMER = 'Spend is estimated from proxied MCP tool calls only. Direct IDE traffic without Mastyf AI is not tracked.';
export function buildCostCoverage(records) {
    const sum = summarizeRecords(records);
    const totalCalls = sum.total;
    const pricedCalls = sum.pricedCalls;
    const unpricedCalls = sum.unpricedCalls;
    const coveragePct = totalCalls > 0 ? Math.round((pricedCalls / totalCalls) * 1000) / 10 : 0;
    let disclaimer = COVERAGE_DISCLAIMER;
    if (unpricedCalls > 0) {
        disclaimer += ` ${unpricedCalls} call(s) in this window lack model pricing (${coveragePct}% coverage).`;
    }
    return {
        pricedCalls,
        unpricedCalls,
        totalCalls,
        coveragePct,
        measuredUsd: sum.costUsd,
        disclaimer,
    };
}
/** Reprice records with tokens but zero costUsd using active model rates (display aggregation). */
export async function repriceRecordsForDisplay(records) {
    const pricing = getRuntimeModelPricing();
    const active = await pricing.getActivePricing();
    if (!active)
        return { records, repricedCount: 0 };
    let repricedCount = 0;
    const out = await Promise.all(records.map(async (r) => {
        if (r.costUsd != null && r.costUsd > 0)
            return r;
        const tokens = (r.requestTokens || 0) + (r.responseTokens || 0);
        if (tokens <= 0)
            return r;
        const model = r.model || resolveModelIdForServer(r.serverName) || active.modelId;
        const resolved = model ? await pricing.resolveModelId(model) : active;
        if (!resolved)
            return r;
        const computed = pricing.computeCost(r.requestTokens || 0, r.responseTokens || 0, resolved);
        if (!computed.priced || computed.costUsd <= 0)
            return r;
        repricedCount++;
        return {
            ...r,
            costUsd: computed.costUsd,
            model: model || r.model,
            pricingSource: computed.source,
        };
    }));
    return { records: out, repricedCount };
}
export function shouldShowCostHeadline(coverage, thresholdPct = 80) {
    return coverage.coveragePct >= thresholdPct && coverage.measuredUsd > 0;
}
/** Allow repriced headlines only when explicitly opted in (env). */
export function allowRepricedCostHeadline() {
    return process.env['MASTYF_AI_COST_SHOW_REPRICED'] === 'true';
}
/**
 * Resolve spendMethod + whether Security Center may show a USD headline.
 * measured = stored costUsd on records; repriced = filled via model rates.
 */
export function resolveSpendHeadline(params) {
    const allowRepriced = params.allowRepriced ?? allowRepricedCostHeadline();
    const before = params.coverageBeforeReprice;
    const after = params.coverageAfterReprice;
    if (shouldShowCostHeadline(before)) {
        return {
            spendMethod: 'measured',
            showHeadline: true,
            headlineUsd: before.measuredUsd,
        };
    }
    if (params.repricedCount > 0 && shouldShowCostHeadline(after)) {
        return {
            spendMethod: 'repriced',
            showHeadline: allowRepriced,
            headlineUsd: allowRepriced ? after.measuredUsd : null,
        };
    }
    if (after.totalCalls === 0 && before.totalCalls === 0) {
        return { spendMethod: 'unavailable', showHeadline: false, headlineUsd: null };
    }
    return {
        spendMethod: after.measuredUsd > 0 || before.measuredUsd > 0 ? 'repriced' : 'unavailable',
        showHeadline: false,
        headlineUsd: null,
    };
}
//# sourceMappingURL=cost-coverage.js.map
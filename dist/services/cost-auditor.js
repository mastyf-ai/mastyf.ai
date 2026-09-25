import { TokenCounter, detectProvider } from '../utils/token-counter.js';
import { Logger } from '../utils/logger.js';
import { getRuntimeModelPricing } from './runtime-model-pricing.js';
import { resolveModelId, resolveModelIdForServer } from '../config/llm-config.js';
import { McpClient } from '../utils/mcp-client.js';
import { allowsCostEstimates, estimateServerCostFromTools, resolveModelListRates, } from '../utils/cost-estimate.js';
/** Per-tenant caps from MASTYF_AI_TENANT_DAILY_BUDGET_JSON={"acme":100,"beta":50}. */
export function getTenantDailyBudgetMap() {
    const map = new Map();
    const raw = process.env['MASTYF_AI_TENANT_DAILY_BUDGET_JSON'];
    if (!raw?.trim())
        return map;
    try {
        const obj = JSON.parse(raw);
        for (const [tenant, val] of Object.entries(obj)) {
            const cap = typeof val === 'number' ? val : parseFloat(String(val));
            if (Number.isFinite(cap) && cap > 0)
                map.set(tenant, cap);
        }
    }
    catch {
        /* ignore */
    }
    return map;
}
/** Parse call_record timestamps (ISO or SQLite UTC `YYYY-MM-DD HH:MM:SS`). */
function parseCallRecordTimestamp(timestamp) {
    if (!timestamp)
        return NaN;
    if (/[TZ]/.test(timestamp))
        return Date.parse(timestamp);
    return Date.parse(timestamp.replace(' ', 'T') + 'Z');
}
/** Daily spend cap from MASTYF_AI_DAILY_BUDGET_USD (preferred) or MASTYF_AI_COST_BUDGET. */
export function getDailyBudgetCapUsd(tenantId) {
    if (tenantId) {
        const perTenant = getTenantDailyBudgetMap().get(tenantId);
        if (perTenant !== undefined)
            return perTenant;
    }
    const daily = process.env['MASTYF_AI_DAILY_BUDGET_USD'] ?? process.env['MASTYF_AI_COST_BUDGET'];
    if (!daily)
        return 0;
    const cap = parseFloat(daily);
    return Number.isFinite(cap) && cap > 0 ? cap : 0;
}
export class CostAuditor {
    tokenCounter;
    db;
    tenantId;
    constructor(_pricingClient, db, _pricingModel, tenantId) {
        this.tokenCounter = new TokenCounter();
        this.db = db;
        this.tenantId = tenantId;
    }
    /** Sum costUsd for all servers since UTC midnight. */
    async getDailySpendUsd(tenantId) {
        if (!this.db)
            return 0;
        const tid = tenantId ?? this.tenantId;
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const cutoff = startOfDay.getTime();
        let total = 0;
        try {
            const names = await this.db.getDistinctActiveServers(tid);
            for (const name of names) {
                const records = await this.db.getCallRecordsForServer(name, 5000, tid);
                for (const r of records) {
                    const ts = parseCallRecordTimestamp(r.timestamp);
                    if (!Number.isNaN(ts) && ts >= cutoff) {
                        total += r.costUsd ?? 0;
                    }
                }
            }
        }
        catch (err) {
            Logger.warn(`Cost audit: daily spend read failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return Math.round(total * 10000) / 10000;
    }
    async isDailyBudgetExceeded(tenantId) {
        const tid = tenantId ?? this.tenantId;
        const capUsd = getDailyBudgetCapUsd(tid);
        if (capUsd <= 0) {
            return { exceeded: false, spentUsd: 0, capUsd: 0 };
        }
        const spentUsd = await this.getDailySpendUsd(tid);
        return { exceeded: spentUsd >= capUsd, spentUsd, capUsd };
    }
    async getPricingModel() {
        const active = await getRuntimeModelPricing().getActivePricing();
        if (active)
            return `${active.displayName} (${active.source})`;
        return resolveModelId() || 'no model detected';
    }
    async auditServer(server, tenantId) {
        const tid = tenantId ?? this.tenantId;
        if (this.db) {
            try {
                const records = await this.db.getCallRecordsForServer(server.name, 5000, tid);
                if (records.length > 0) {
                    const report = await this.buildReportFromRecords(server.name, records, server);
                    return {
                        ...report,
                        costSource: 'actual',
                        priced: report.estimatedCostUSD > 0 || !report.unpricedCalls,
                    };
                }
            }
            catch (err) {
                Logger.warn(`Cost audit: DB read failed for ${server.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return this.auditWithoutProxyRecords(server);
    }
    /**
     * No proxy call_records: resolve real model, optionally probe connectivity,
     * report list rates only (zero measured cost) unless MASTYF_AI_COST_ALLOW_ESTIMATES=true.
     */
    async auditWithoutProxyRecords(server) {
        const tid = this.tenantId;
        const modelId = resolveModelIdForServer(server.name, server.env, server.args);
        const provider = detectProvider(modelId);
        const rates = await resolveModelListRates(modelId);
        const untrackedSse = server.transport === 'sse' || (!!server.url && !server.command);
        let proxyDataHint = null;
        if (this.db) {
            try {
                const activeNames = await this.db.getDistinctActiveServers(tid);
                if (activeNames.length === 0) {
                    proxyDataHint =
                        'No call_records in database — run `mastyf-ai proxy` and send tools/call (see scenarios/real-life/run-live-proxy-test.mjs)';
                }
                else if (!activeNames.includes(server.name)) {
                    proxyDataHint = `No call_records for "${server.name}" — proxy traffic exists for: ${activeNames.join(', ')}`;
                }
            }
            catch {
                /* ignore */
            }
        }
        if (!server.command && !server.url) {
            return this.emptyReport(server.name, 'No command or URL configured — cannot probe server.', {
                modelId,
                provider,
                costSource: 'none',
                listInputPerM: rates.inputPerM,
                listOutputPerM: rates.outputPerM,
            });
        }
        const probe = await McpClient.probe(server);
        if (!probe.success) {
            const reason = probe.error
                ? `Probe failed: ${probe.error}`
                : probe.authRequired
                    ? 'Server requires authentication — configure credentials in server env'
                    : 'Could not reach server';
            const sseNote = untrackedSse
                ? `${reason}. SSE traffic is untracked unless routed through \`mastyf-ai proxy\` or wrap.`
                : reason;
            return this.modelOnlyReport(server.name, modelId, provider, rates, sseNote, probe.tools?.length ?? 0);
        }
        const toolCount = probe.tools?.length ?? probe.toolCount ?? 0;
        if (allowsCostEstimates() && probe.tools && probe.tools.length > 0) {
            return this.estimatedReportFromTools(server, probe.tools, modelId, provider, untrackedSse);
        }
        const noteParts = [
            `Model: ${modelId} (${provider})`,
            rates.priced
                ? `List rates: $${rates.inputPerM}/M input, $${rates.outputPerM}/M output (${rates.pricingSources.join(', ') || rates.pricingModel})`
                : 'Rates unresolved — set MASTYF_AI_MODEL or use Cline/LiteLLM pricing',
            toolCount > 0
                ? `${toolCount} tool(s) reachable via tools/list — $0 measured (no proxy traffic)`
                : 'Server reachable — no tools listed',
            proxyDataHint,
            'Run \`mastyf-ai proxy\` for measured token and USD costs from real tools/call traffic',
            untrackedSse ? 'SSE IDE traffic is untracked unless clients use Mastyf AI proxy/wrap' : null,
            allowsCostEstimates()
                ? null
                : 'Set MASTYF_AI_COST_ALLOW_ESTIMATES=true to enable legacy tools/list simulation',
        ].filter(Boolean);
        return {
            serverName: server.name,
            tokensUsed: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUSD: 0,
            actualCostUSD: 0,
            pricingModel: rates.pricingModel,
            pricingSources: rates.pricingSources,
            toolBreakdown: [],
            note: noteParts.join('; '),
            modelId,
            provider,
            costSource: 'model-only',
            priced: rates.priced,
            listInputPerM: rates.inputPerM,
            listOutputPerM: rates.outputPerM,
        };
    }
    modelOnlyReport(serverName, modelId, provider, rates, reason, toolCount) {
        const rateNote = rates.priced
            ? `List rates: $${rates.inputPerM}/M input, $${rates.outputPerM}/M output`
            : 'Rates unresolved for resolved model';
        return {
            serverName,
            tokensUsed: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUSD: 0,
            actualCostUSD: 0,
            pricingModel: rates.pricingModel,
            pricingSources: rates.pricingSources,
            toolBreakdown: [],
            note: `${reason}; ${rateNote}; Model: ${modelId} (${provider})${toolCount > 0 ? `; ${toolCount} tool(s) known` : ''}; run proxy for measured cost`,
            modelId,
            provider,
            costSource: 'model-only',
            priced: rates.priced,
            listInputPerM: rates.inputPerM,
            listOutputPerM: rates.outputPerM,
        };
    }
    async estimatedReportFromTools(server, tools, modelId, provider, untrackedSse) {
        const estimate = await estimateServerCostFromTools(tools, modelId, this.tokenCounter);
        const noteParts = [
            `LEGACY ESTIMATE (MASTYF_AI_COST_ALLOW_ESTIMATES=true): simulated ${tools.length} tool(s) via tools/list`,
            `Model: ${modelId} (${provider})`,
            !estimate.priced
                ? 'Rates unresolved — set MASTYF_AI_MODEL or activate Cline/LiteLLM pricing'
                : null,
            untrackedSse ? 'SSE: live IDE traffic still untracked unless clients use Mastyf AI proxy/wrap' : null,
        ].filter(Boolean);
        return {
            serverName: server.name,
            tokensUsed: estimate.totalTokens,
            inputTokens: estimate.inputTokens,
            outputTokens: estimate.outputTokens,
            estimatedCostUSD: estimate.costUsd,
            actualCostUSD: 0,
            pricingModel: estimate.pricingModel,
            pricingSources: estimate.pricingSources,
            toolBreakdown: estimate.toolBreakdown,
            unpricedCalls: estimate.unpricedTools > 0 ? estimate.unpricedTools : undefined,
            note: noteParts.join('; '),
            modelId,
            provider,
            costSource: 'estimated',
            priced: estimate.priced,
        };
    }
    emptyReport(serverName, note, meta) {
        return {
            serverName,
            tokensUsed: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUSD: 0,
            actualCostUSD: 0,
            pricingModel: 'none',
            pricingSources: [],
            toolBreakdown: [],
            unpricedCalls: 0,
            note,
            modelId: meta?.modelId,
            provider: meta?.provider,
            costSource: meta?.costSource ?? 'none',
            priced: meta?.priced ?? false,
            listInputPerM: meta?.listInputPerM,
            listOutputPerM: meta?.listOutputPerM,
        };
    }
    async buildReportFromRecords(serverName, records, server) {
        const pricing = getRuntimeModelPricing();
        const toolMap = new Map();
        const sources = new Set();
        let totalInput = 0;
        let totalOutput = 0;
        let actualCostUSD = 0;
        let unpricedCalls = 0;
        let apiSourcedCalls = 0;
        let estimatedCalls = 0;
        const active = await pricing.getActivePricing();
        const pricingModel = active?.displayName || active?.modelId || 'unresolved';
        let primaryModel;
        for (const r of records) {
            if (r.tokenSource === 'api')
                apiSourcedCalls++;
            else if (r.tokenSource === 'estimated')
                estimatedCalls++;
            const existing = toolMap.get(r.toolName) || {
                inputTokens: 0, outputTokens: 0, calls: 0, cost: 0, models: new Set(),
            };
            existing.inputTokens += r.requestTokens;
            existing.outputTokens += r.responseTokens;
            existing.calls += 1;
            let callCost = r.costUsd ?? 0;
            const recordModel = r.model ||
                resolveModelIdForServer(serverName, server?.env, server?.args);
            if (callCost <= 0 && recordModel) {
                const resolved = await pricing.resolveModelId(recordModel);
                if (resolved) {
                    callCost = pricing.computeCost(r.requestTokens, r.responseTokens, resolved).costUsd;
                    if (callCost > 0)
                        sources.add(resolved.source);
                }
            }
            else if (callCost > 0 && r.pricingSource) {
                sources.add(r.pricingSource);
            }
            if (callCost > 0) {
                existing.cost += callCost;
                actualCostUSD += callCost;
            }
            else if ((r.requestTokens || 0) + (r.responseTokens || 0) > 0) {
                unpricedCalls++;
            }
            if (recordModel) {
                existing.models.add(recordModel);
                primaryModel = primaryModel || recordModel;
            }
            toolMap.set(r.toolName, existing);
            totalInput += r.requestTokens;
            totalOutput += r.responseTokens;
        }
        if (active)
            sources.add(active.source);
        const breakdown = [];
        for (const [toolName, data] of toolMap) {
            breakdown.push({
                toolName,
                tokens: data.inputTokens + data.outputTokens,
                calls: data.calls,
                cost: Math.round(data.cost * 10000) / 10000,
            });
        }
        const modelId = primaryModel || resolveModelIdForServer(serverName, server?.env, server?.args);
        return {
            serverName,
            tokensUsed: totalInput + totalOutput,
            inputTokens: totalInput,
            outputTokens: totalOutput,
            estimatedCostUSD: Math.round(actualCostUSD * 10000) / 10000,
            actualCostUSD: Math.round(actualCostUSD * 10000) / 10000,
            pricingModel,
            pricingSources: [...sources],
            toolBreakdown: breakdown,
            unpricedCalls,
            modelId,
            provider: detectProvider(modelId),
            note: [
                'Measured from proxy call_records',
                unpricedCalls > 0
                    ? `${unpricedCalls} call(s) could not be priced — set MASTYF_AI_MODEL or use live pricing`
                    : null,
                apiSourcedCalls > 0 || estimatedCalls > 0
                    ? `Token sources: ${apiSourcedCalls} API, ${estimatedCalls} estimated`
                    : null,
            ]
                .filter(Boolean)
                .join('; ') || undefined,
        };
    }
    countTokens(text) {
        return this.tokenCounter.count(text);
    }
    dispose() {
        this.tokenCounter.free();
    }
}
//# sourceMappingURL=cost-auditor.js.map
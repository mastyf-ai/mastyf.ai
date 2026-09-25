import { execSync } from 'child_process';
import { Logger } from '../utils/logger.js';
import { fetchSignedRemotePricing } from './pricing-remote.js';
import { detectZeroPricingAlert } from './pricing-signature.js';
// Last reviewed date for STATIC_PRICING — update when the table is refreshed.
export const PRICING_TABLE_DATE = '2025-03-01';
export const PRICING_STALENESS_DAYS = 30;
export function getPricingStalenessWarning() {
    const stale = new Date(PRICING_TABLE_DATE);
    const ageMs = Date.now() - stale.getTime();
    const ageDays = Math.floor(ageMs / 86_400_000);
    if (ageDays > PRICING_STALENESS_DAYS) {
        return `Pricing cache is ${ageDays} days old. Run litellm to refresh.`;
    }
    return null;
}
// Last-reviewed rates (2025-03-01). Used when live litellm/remote pricing is unavailable.
const STATIC_PRICING = {
    'gpt-4.5-preview': { input: 75.00, output: 150.00 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'o1-preview': { input: 15.00, output: 60.00 },
    'o1-mini': { input: 3.00, output: 12.00 },
    'claude-3-opus': { input: 15.00, output: 75.00 },
    'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
    'claude-3-5-haiku': { input: 0.80, output: 4.00 },
    'claude-3-7-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-7-sonnet-20250219': { input: 3.00, output: 15.00 },
    'claude-sonnet-4': { input: 3.00, output: 15.00 },
    'claude-opus-4': { input: 15.00, output: 75.00 },
    'gemini-2.5-pro': { input: 1.25, output: 5.00 },
    'gemini-2.0-flash': { input: 0.10, output: 0.40 },
    'gemini-2.0-flash-lite': { input: 0.075, output: 0.30 },
    'gemini-1.5-pro': { input: 1.25, output: 5.00 },
    'gemini-1.5-flash': { input: 0.075, output: 0.30 },
    'gemini-2.5-flash': { input: 0.15, output: 0.60 },
    'gemini-pro': { input: 1.25, output: 5.00 },
    'deepseek-chat': { input: 0.28, output: 0.42 },
    'deepseek-reasoner': { input: 0.55, output: 2.19 },
    'grok-3': { input: 3.00, output: 15.00 },
    'grok-2': { input: 2.00, output: 10.00 },
    'grok-2-mini': { input: 0.20, output: 0.80 },
    'llama-3.1-405b': { input: 3.50, output: 3.50 },
    'llama-3.1-70b': { input: 0.59, output: 0.79 },
    'llama-3.3-70b': { input: 0.59, output: 0.79 },
    'llama-3.1-8b': { input: 0.18, output: 0.18 },
    'mistral-large': { input: 4.00, output: 12.00 },
    'mistral-small': { input: 1.00, output: 3.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'gpt-4-32k': { input: 60.00, output: 120.00 },
    'claude-3-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-haiku': { input: 0.25, output: 1.25 },
    'o3-mini': { input: 1.10, output: 4.40 },
    'o3': { input: 10.00, output: 40.00 },
    'codestral': { input: 0.30, output: 0.90 },
    'command-r-plus': { input: 3.00, output: 15.00 },
    'command-r': { input: 0.50, output: 1.50 },
    'sonar': { input: 1.00, output: 1.00 },
    'sonar-pro': { input: 3.00, output: 15.00 },
    'qwen3:8b': { input: 0.00, output: 0.00 },
    'qwen2.5:1.5b': { input: 0.00, output: 0.00 },
    'mastyf-guard-v6': { input: 0.00, output: 0.00 },
};
const DEFAULT_UNKNOWN_PRICING = { input: 10.0, output: 30.0 };
// Live pricing from litellm, cached with 1-hour TTL
const pricingCache = new Map();
const CACHE_TTL_MS = 3600_000; // 1 hour
export class PricingClient {
    customPricing = new Map();
    liveModels = [];
    /**
     * Sync cost estimate (per-million tokens). Third arg `true` = output pricing.
     * Uses live/custom rates when present, otherwise the last-reviewed static table.
     */
    calculateCost(tokens, model, isOutput = false) {
        const pricing = this.getPricingForModel(model) ?? DEFAULT_UNKNOWN_PRICING;
        const rate = isOutput ? pricing.output : pricing.input;
        return (tokens / 1_000_000) * rate;
    }
    getPricingForModel(model) {
        return this.customPricing.get(model)
            ?? STATIC_PRICING[model]
            ?? null;
    }
    listModels() {
        const names = new Set([
            ...Object.keys(STATIC_PRICING),
            ...this.customPricing.keys(),
            ...this.liveModels,
        ]);
        return [...names].sort();
    }
    addPricing(model, inputPerMillion, outputPerMillion) {
        if (inputPerMillion <= 0 && outputPerMillion <= 0) {
            Logger.error(`[pricing] Rejected zero-price override for model ${model}`);
            return;
        }
        this.customPricing.set(model, { input: inputPerMillion, output: outputPerMillion });
    }
    /** Best-effort live refresh via signed remote URL or litellm. */
    async refreshLivePricing() {
        const remoteUrl = process.env['MASTYF_AI_PRICING_URL']?.trim();
        if (remoteUrl) {
            try {
                const models = await fetchSignedRemotePricing(remoteUrl);
                if (models) {
                    for (const [model, rates] of Object.entries(models)) {
                        this.customPricing.set(model, rates);
                    }
                    this.liveModels = Object.keys(models);
                    return;
                }
            }
            catch (err) {
                Logger.warn(`[pricing] Signed remote pricing unavailable: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        const models = this.getAvailableModels();
        const fetched = [];
        for (const model of models.slice(0, 5)) {
            const live = await this.fetchLivePricing(model);
            if (live) {
                this.customPricing.set(model, live);
                fetched.push(model);
            }
        }
        this.liveModels = fetched;
    }
    /**
     * Get live pricing for a model via litellm.
     */
    async getModelPricing(model) {
        // Check cache
        const cached = pricingCache.get(model);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
            return { input: cached.input, output: cached.output, isLive: true };
        }
        // Try litellm for live pricing
        const livePrice = await this.fetchLivePricing(model);
        if (livePrice) {
            pricingCache.set(model, { input: livePrice.input, output: livePrice.output, fetchedAt: Date.now() });
            return { input: livePrice.input, output: livePrice.output, isLive: true };
        }
        const staticPrice = STATIC_PRICING[model];
        if (staticPrice)
            return { ...staticPrice, isLive: false };
        return undefined;
    }
    /**
     * Fetch live pricing via litellm Python subprocess.
     * litellm has built-in pricing for 100+ models updated from provider APIs.
     */
    async fetchLivePricing(model) {
        try {
            const pythonScript = `
import json
try:
    import litellm
    # litellm.model_cost has live pricing for all models
    cost = litellm.model_cost.get("${model}", None)
    if cost:
        print(json.dumps({
            "input": cost.get("input_cost_per_token", 0) * 1_000_000,
            "output": cost.get("output_cost_per_token", 0) * 1_000_000
        }))
    else:
        # Try fuzzy match via litellm
        for k in litellm.model_cost:
            if k.startswith("${model.split('-')[0]}"):
                cost = litellm.model_cost[k]
                print(json.dumps({
                    "input": cost.get("input_cost_per_token", 0) * 1_000_000,
                    "output": cost.get("output_cost_per_token", 0) * 1_000_000,
                    "matched_model": k
                }))
                break
        else:
            print(json.dumps({"error": "model not found"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
            const result = execSync(`python3 -c "${pythonScript}"`, {
                encoding: 'utf-8',
                timeout: 8000,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const data = JSON.parse(result);
            if (data?.input !== undefined && data?.output !== undefined) {
                const zero = detectZeroPricingAlert({ [model]: { input: data.input, output: data.output } });
                if (zero.length > 0) {
                    Logger.error(`[pricing] litellm returned zero price for ${model} — ignored`);
                    return null;
                }
                return { input: data.input, output: data.output };
            }
        }
        catch (err) {
            Logger.debug(`litellm pricing fetch failed for ${model}: ${err instanceof Error ? err.message : String(err)}`);
        }
        return null;
    }
    /**
     * Calculate cost using live pricing when available.
     */
    async calculateCostAsync(model, inputTokens, outputTokens) {
        const pricing = await this.getModelPricing(model);
        if (!pricing) {
            return { cost: 0, isLive: false, priced: false };
        }
        const cost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
        return { cost: Math.round(cost * 1_000_000) / 1_000_000, isLive: pricing.isLive, priced: true };
    }
    /** Synchronous version for compatibility. Returns 0 when pricing is unavailable. */
    estimateCost(model, inputTokens, outputTokens) {
        const pricing = this.getPricingForModel(model);
        if (!pricing)
            return 0;
        return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
    }
    getAvailableModels() {
        return Object.keys(STATIC_PRICING);
    }
    getPricingDate() {
        return PRICING_TABLE_DATE;
    }
}
//# sourceMappingURL=pricing-client.js.map
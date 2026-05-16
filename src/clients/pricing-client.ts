import { execSync } from 'child_process';
import { Logger } from '../utils/logger.js';

// Last reviewed date for STATIC_PRICING — update when pricing table is refreshed
export const PRICING_TABLE_DATE = '2025-03-01';
export const PRICING_STALENESS_DAYS = 30;

export function getPricingStalenessWarning(): string | null {
  const stale = new Date(PRICING_TABLE_DATE);
  const ageMs  = Date.now() - stale.getTime();
  const ageDays = Math.floor(ageMs / 86_400_000);
  if (ageDays > PRICING_STALENESS_DAYS) {
    return `Pricing cache is ${ageDays} days old. Run litellm to refresh.`;
  }
  return null;
}

// Hardcoded fallback — used only when litellm is unavailable
const STATIC_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.5-preview':   { input: 75.00, output: 150.00 },
  'gpt-4-turbo':       { input: 10.00, output: 30.00 },
  'gpt-4o':            { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':       { input: 0.15,  output: 0.60 },
  'o1-preview':        { input: 15.00, output: 60.00 },
  'o1-mini':           { input: 3.00,  output: 12.00 },
  'claude-3-opus':     { input: 15.00, output: 75.00 },
  'claude-3-5-sonnet': { input: 3.00,  output: 15.00 },
  'claude-3-5-haiku':  { input: 0.80,  output: 4.00 },
  'gemini-2.0-flash':  { input: 0.10,  output: 0.40 },
  'gemini-1.5-pro':    { input: 1.25,  output: 5.00 },
  'deepseek-chat':     { input: 0.28,  output: 0.42 },
  'deepseek-reasoner': { input: 0.55,  output: 2.19 },
  'llama-3.1-405b':    { input: 3.50,  output: 3.50 },
  'llama-3.1-70b':     { input: 0.59,  output: 0.79 },
  'mistral-large':     { input: 4.00,  output: 12.00 },
  'mistral-small':     { input: 1.00,  output: 3.00 },
};

// Live pricing from litellm, cached with 1-hour TTL
const pricingCache = new Map<string, { input: number; output: number; fetchedAt: number }>();
const CACHE_TTL_MS = 3600_000; // 1 hour

export class PricingClient {
  /**
   * Get live pricing for a model via litellm.
   * Falls back to static table if litellm unavailable.
   */
  async getModelPricing(model: string): Promise<{ input: number; output: number; isLive: boolean } | undefined> {
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

    // Fallback to static
    const staticPrice = STATIC_PRICING[model];
    if (staticPrice) return { ...staticPrice, isLive: false };

    // Default fallback
    const defaultPrice = STATIC_PRICING['gpt-4o'];
    return defaultPrice ? { ...defaultPrice, isLive: false } : undefined;
  }

  /**
   * Fetch live pricing via litellm Python subprocess.
   * litellm has built-in pricing for 100+ models updated from provider APIs.
   */
  private async fetchLivePricing(model: string): Promise<{ input: number; output: number } | null> {
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
        return { input: data.input, output: data.output };
      }
    } catch (err) {
      Logger.debug(`litellm pricing fetch failed for ${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }

  /**
   * Calculate cost using live pricing when available, static fallback otherwise.
   */
  async calculateCost(model: string, inputTokens: number, outputTokens: number): Promise<{ cost: number; isLive: boolean }> {
    const pricing = await this.getModelPricing(model);
    if (!pricing) {
      // Default to gpt-4o pricing as last resort
      const defaultPrice = STATIC_PRICING['gpt-4o'] ?? { input: 2.50, output: 10.00 };
      const cost = (inputTokens / 1_000_000) * defaultPrice.input + (outputTokens / 1_000_000) * defaultPrice.output;
      return { cost: Math.round(cost * 1_000_000) / 1_000_000, isLive: false };
    }
    const cost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
    return { cost: Math.round(cost * 1_000_000) / 1_000_000, isLive: pricing.isLive };
  }

  /** Synchronous version for backward compat — uses static pricing only */
  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = STATIC_PRICING[model] ?? STATIC_PRICING['gpt-4o'] ?? { input: 2.50, output: 10.00 };
    return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  }

  getAvailableModels(): string[] {
    return Object.keys(STATIC_PRICING);
  }

  getPricingDate(): string {
    return PRICING_TABLE_DATE;
  }
}
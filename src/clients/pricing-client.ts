/**
 * Cached token pricing from major LLM providers.
 * Rates per 1M tokens (as of mid-2025).
 */
const PRICING_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 5.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

export class PricingClient {
  /**
   * Calculate estimated cost for a given number of tokens.
   * @param tokens - Total token count
   * @param model - Model identifier (e.g. 'gpt-4o')
   * @param isOutput - Whether these are output tokens (priced higher)
   * @returns Estimated cost in USD
   */
  calculateCost(tokens: number, model: string, isOutput: boolean = false): number {
    const price = PRICING_TABLE[model];
    if (!price) {
      // Unknown model — use a conservative default of $10/M input, $30/M output
      const rate = isOutput ? 30.0 : 10.0;
      return (tokens / 1_000_000) * rate;
    }
    const rate = isOutput ? price.output : price.input;
    return (tokens / 1_000_000) * rate;
  }

  /**
   * Get the full pricing record for a model, or null if unknown.
   */
  getPricingForModel(model: string): { input: number; output: number } | null {
    return PRICING_TABLE[model] ?? null;
  }

  /**
   * List all known model pricing entries.
   */
  listModels(): string[] {
    return Object.keys(PRICING_TABLE);
  }
}
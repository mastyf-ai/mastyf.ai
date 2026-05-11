/**
 * Comprehensive token pricing for all major LLM providers.
 * Rates per 1M tokens (as of mid-2025).
 * Override via PRICING_OVERRIDES env var (JSON): {"model-name": {"input": N, "output": N}}
 */
const DEFAULT_PRICING_TABLE: Record<string, { input: number; output: number }> = {
  // ── OpenAI ──────────────────────────────────────────
  'gpt-4o': { input: 5.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.5-preview': { input: 75.0, output: 150.0 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-4-32k': { input: 60.0, output: 120.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'gpt-3.5-turbo-16k': { input: 3.0, output: 4.0 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o3': { input: 10.0, output: 40.0 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'gpt-4o-realtime-preview': { input: 5.0, output: 20.0 },

  // ── Anthropic ───────────────────────────────────────
  'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-opus': { input: 15.0, output: 75.0 },
  'claude-3-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-3-5-haiku': { input: 0.8, output: 4.0 },
  'claude-2.1': { input: 8.0, output: 24.0 },
  'claude-2.0': { input: 8.0, output: 24.0 },
  'claude-instant': { input: 0.8, output: 2.4 },

  // ── Google DeepMind ─────────────────────────────────
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.3 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 },
  'gemini-1.0-pro': { input: 0.5, output: 1.5 },
  'gemini-1.0-ultra': { input: 0.5, output: 1.5 },
  'gemma-2-27b': { input: 0.27, output: 0.27 },
  'gemma-2-9b': { input: 0.1, output: 0.1 },
  'gemma-3-27b': { input: 0.15, output: 0.15 },

  // ── DeepSeek ────────────────────────────────────────
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'deepseek-v3': { input: 0.27, output: 1.1 },
  'deepseek-r1': { input: 0.55, output: 2.19 },

  // ── xAI (Grok) ──────────────────────────────────────
  'grok-3': { input: 3.0, output: 15.0 },
  'grok-3-mini': { input: 0.3, output: 0.5 },
  'grok-2': { input: 2.0, output: 10.0 },
  'grok-2-vision': { input: 2.0, output: 10.0 },
  'grok-1.5': { input: 5.0, output: 15.0 },

  // ── Meta (Llama via Cloud APIs) ─────────────────────
  'llama-4-maverick': { input: 0.2, output: 0.6 },
  'llama-4-scout': { input: 0.15, output: 0.4 },
  'llama-3.3-70b': { input: 0.59, output: 0.79 },
  'llama-3.1-405b': { input: 2.0, output: 6.0 },
  'llama-3.1-70b': { input: 0.59, output: 0.79 },
  'llama-3.1-8b': { input: 0.06, output: 0.06 },
  'llama-3-70b': { input: 0.59, output: 0.79 },
  'llama-3-8b': { input: 0.06, output: 0.06 },

  // ── Mistral ─────────────────────────────────────────
  'mistral-large': { input: 2.0, output: 6.0 },
  'mistral-medium': { input: 2.7, output: 8.1 },
  'mistral-small': { input: 0.2, output: 0.6 },
  'mistral-nemo': { input: 0.15, output: 0.15 },
  'mistral-7b': { input: 0.08, output: 0.08 },
  'mixtral-8x7b': { input: 0.24, output: 0.24 },
  'mixtral-8x22b': { input: 1.0, output: 1.0 },
  'codestral': { input: 0.2, output: 0.6 },
  'pixtral-large': { input: 2.0, output: 6.0 },

  // ── Cohere ──────────────────────────────────────────
  'command-r-plus': { input: 2.5, output: 10.0 },
  'command-r': { input: 0.5, output: 1.5 },
  'command': { input: 0.5, output: 1.5 },
  'command-light': { input: 0.3, output: 0.6 },

  // ── AI21 Labs ───────────────────────────────────────
  'jamba-1.5-large': { input: 2.0, output: 8.0 },
  'jamba-1.5-mini': { input: 0.2, output: 0.4 },
  'jamba-instruct': { input: 0.5, output: 1.5 },

  // ── Reka ────────────────────────────────────────────
  'reka-core': { input: 3.0, output: 10.0 },
  'reka-flash': { input: 0.25, output: 1.0 },
  'reka-edge': { input: 0.4, output: 1.0 },

  // ── Amazon (Bedrock) ────────────────────────────────
  'amazon-titan-text-premier': { input: 0.5, output: 1.5 },
  'amazon-titan-text-lite': { input: 0.15, output: 0.2 },
  'amazon-titan-text-express': { input: 0.2, output: 0.6 },
  'amazon-nova-pro': { input: 2.0, output: 8.0 },
  'amazon-nova-lite': { input: 0.15, output: 0.4 },
  'amazon-nova-micro': { input: 0.05, output: 0.1 },

  // ── Alibaba (Qwen) ──────────────────────────────────
  'qwen-max': { input: 2.0, output: 6.0 },
  'qwen-plus': { input: 0.4, output: 1.2 },
  'qwen-turbo': { input: 0.2, output: 0.4 },
  'qwen-coder-plus': { input: 0.7, output: 1.4 },
  'qwen-2.5-72b': { input: 0.58, output: 1.16 },
  'qwen-2.5-32b': { input: 0.27, output: 0.54 },
  'qwen-2.5-7b': { input: 0.07, output: 0.07 },

  // ── Zhipu AI (GLM) ──────────────────────────────────
  'glm-4-plus': { input: 2.0, output: 6.0 },
  'glm-4-air': { input: 0.5, output: 1.0 },
  'glm-4-flash': { input: 0.05, output: 0.1 },

  // ── 01.AI (Yi) ──────────────────────────────────────
  'yi-large': { input: 2.0, output: 6.0 },
  'yi-medium': { input: 0.5, output: 1.0 },
  'yi-small': { input: 0.1, output: 0.1 },

  // ── Writer ──────────────────────────────────────────
  'palmyra-x-004': { input: 3.0, output: 10.0 },
  'palmyra-med': { input: 0.5, output: 1.5 },

  // ── Perplexity ──────────────────────────────────────
  'sonar-pro': { input: 5.0, output: 15.0 },
  'sonar': { input: 2.0, output: 5.0 },
  'sonar-reasoning': { input: 3.0, output: 15.0 },

  // ── HuggingFace ─────────────────────────────────────
  'zephyr-7b-beta': { input: 0.05, output: 0.05 },
  'falcon-180b': { input: 1.0, output: 1.0 },
  'falcon-40b': { input: 0.5, output: 0.5 },
};

function loadCustomPricing(): Record<string, { input: number; output: number }> {
  const overrides = process.env['PRICING_OVERRIDES'];
  if (!overrides) return {};

  try {
    const parsed = JSON.parse(overrides);
    const result: Record<string, { input: number; output: number }> = {};
    for (const [model, rates] of Object.entries(parsed)) {
      const r = rates as Record<string, unknown>;
      if (typeof r.input === 'number' && typeof r.output === 'number') {
        result[model] = { input: r.input, output: r.output };
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Try to fetch live pricing data from a public source.
 * Falls back silently to the hardcoded table on failure.
 * Opt-in: set ENABLE_LIVE_PRICING=true to enable.
 */
async function fetchLivePricing(): Promise<Record<string, { input: number; output: number }>> {
  if (process.env['ENABLE_LIVE_PRICING'] !== 'true') return {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return {};
    const raw = (await res.json()) as Record<string, any>;
    const parsed: Record<string, { input: number; output: number }> = {};
    for (const [model, data] of Object.entries(raw)) {
      if (data.input_cost_per_token && data.output_cost_per_token) {
        parsed[model] = {
          input: data.input_cost_per_token * 1_000_000,
          output: data.output_cost_per_token * 1_000_000,
        };
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

let liveCache: Record<string, { input: number; output: number }> | null = null;
let lastFetch = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class PricingClient {
  private prices: Record<string, { input: number; output: number }>;

  constructor() {
    const custom = loadCustomPricing();
    this.prices = { ...DEFAULT_PRICING_TABLE, ...custom };
  }

  /** Init live pricing async — call once on startup. */
  async refreshLivePricing(): Promise<void> {
    if (Date.now() - lastFetch > CACHE_TTL_MS) {
      liveCache = await fetchLivePricing();
      lastFetch = Date.now();
    }
    if (liveCache) {
      this.prices = { ...DEFAULT_PRICING_TABLE, ...liveCache, ...loadCustomPricing() };
    }
  }

  /** Calculate estimated cost for a given number of tokens. Returns null for unknown models — no fabricated defaults. */
  calculateCost(tokens: number, model: string, isOutput: boolean = false): number | null {
    const price = this.prices[model];
    if (!price) {
      return null;
    }
    const rate = isOutput ? price.output : price.input;
    return (tokens / 1_000_000) * rate;
  }

  /** Get the full pricing record for a model, or null if unknown. */
  getPricingForModel(model: string): { input: number; output: number } | null {
    return this.prices[model] ?? null;
  }

  /** List all known model pricing entries. */
  listModels(): string[] {
    return Object.keys(this.prices);
  }

  /** Add or update pricing for a model at runtime. */
  addPricing(model: string, inputCost: number, outputCost: number): void {
    this.prices[model] = { input: inputCost, output: outputCost };
  }
}

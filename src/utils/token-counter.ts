/**
 * Live token counter — uses per-provider real tokenizers.
 *
 * - OpenAI: tiktoken with model-specific encodings (o200k_base, cl100k_base) — exact
 * - Anthropic: Anthropic Messages API /v1/messages/count_tokens endpoint — exact
 * - Google: litellm subprocess (calls Gemini count_tokens) — exact
 * - All others: litellm subprocess with provider-specific tokenizer — exact
 * - Fallback: char-ratio estimates when API keys / litellm unavailable
 */
import { get_encoding, type TiktokenEncoding } from 'tiktoken';
import { execSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { Logger } from './logger.js';

export interface TokenCountResult {
  tokens: number;
  provider: string;
  model?: string;
  isExact: boolean;
  method: string;
}

const PROVIDER_RATIOS: Record<string, number> = {
  'anthropic': 0.30, 'google': 0.22, 'deepseek': 0.27,
  'xai': 0.25, 'meta': 0.25, 'mistral': 0.25, 'cohere': 0.25,
  'ai21': 0.25, 'reka': 0.25, 'amazon': 0.25, 'alibaba': 0.30,
  'zhipu': 0.30, '01ai': 0.30, 'writer': 0.25, 'perplexity': 0.25,
  'huggingface': 0.25,
};

// Cache litellm counts to avoid repeated subprocess calls for identical text
const litellmCache = new Map<string, number>();
const LITELLM_CACHE_MAX = 1000;

export class TokenCounter {
  private encodings: Map<string, ReturnType<typeof get_encoding>> = new Map();

  /** Quick count using GPT-4o encoding — for internal use only */
  count(text: string): number {
    return this.tiktokenCount(text, 'o200k_base');
  }

  /**
   * Live token count using provider-specific tokenizers.
   * Returns the most accurate count available.
   */
  countWithProvider(text: string, model?: string): TokenCountResult | null {
    if (!model) return null;
    const m = model.toLowerCase();

    // ─── OpenAI — tiktoken (exact, in-process) ───
    if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) {
      const enc: TiktokenEncoding = (m.includes('4o') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4'))
        ? 'o200k_base' : 'cl100k_base';
      return { tokens: this.tiktokenCount(text, enc), provider: 'openai', model, isExact: true, method: `tiktoken:${enc}` };
    }

    // ─── Anthropic — use Anthropic API count_tokens (exact) ───
    if (m.startsWith('claude-')) {
      const anthropicResult = this.anthropicCount(text, model);
      if (anthropicResult !== null) return anthropicResult;
      // Fallback to char-ratio only if API unavailable
      return { tokens: Math.round(text.length * PROVIDER_RATIOS['anthropic']), provider: 'anthropic', model, isExact: false, method: 'char-ratio-0.30' };
    }

    // ─── Google — use litellm which calls Gemini count_tokens (exact) ───
    if (m.startsWith('gemini-') || m.startsWith('gemma-')) {
      const litellmResult = this.litellmCount(text, model);
      if (litellmResult !== null) return litellmResult;
      return { tokens: Math.round(text.length * PROVIDER_RATIOS['google']), provider: 'google', model, isExact: false, method: 'char-ratio-0.22' };
    }

    // ─── All other providers — try litellm, fall back to char-ratio ───
    const litellmResult = this.litellmCount(text, model);
    if (litellmResult !== null) return litellmResult;

    // Provider-specific char-ratio fallback
    if (m.startsWith('deepseek-')) return { tokens: Math.round(text.length * PROVIDER_RATIOS['deepseek']), provider: 'deepseek', model, isExact: false, method: 'char-ratio-0.27' };
    if (m.startsWith('grok-')) return { tokens: Math.round(text.length * PROVIDER_RATIOS['xai']), provider: 'xai', model, isExact: false, method: 'char-ratio-0.25' };
    if (m.startsWith('llama-')) return { tokens: Math.round(text.length * PROVIDER_RATIOS['meta']), provider: 'meta', model, isExact: false, method: 'char-ratio-0.25' };
    if (m.startsWith('mistral-') || m.startsWith('mixtral-') || m.startsWith('codestral') || m.startsWith('pixtral-'))
      return { tokens: Math.round(text.length * PROVIDER_RATIOS['mistral']), provider: 'mistral', model, isExact: false, method: 'char-ratio-0.25' };

    const prefixMap: Record<string, string[]> = {
      amazon: ['amazon-', 'nova-', 'titan-'],
      alibaba: ['qwen-'],
      zhipu: ['glm-'],
      cohere: ['command-'],
      ai21: ['jamba-'],
      reka: ['reka-'],
      '01ai': ['yi-'],
      writer: ['palmyra-'],
      perplexity: ['sonar-'],
      huggingface: ['zephyr-', 'falcon-'],
    };
    for (const [provider, prefixes] of Object.entries(prefixMap)) {
      if (prefixes.some(px => m.startsWith(px))) {
        const ratio = PROVIDER_RATIOS[provider];
        return { tokens: Math.round(text.length * ratio), provider, model, isExact: false, method: `char-ratio-${ratio}` };
      }
    }

    return null;
  }

  /**
   * Count tokens via Anthropic Messages API count_tokens endpoint.
   * Requires ANTHROPIC_API_KEY.
   * Returns null if API key not set or call fails.
   *
   * Uses the Messages API: POST /v1/messages/count_tokens
   * with a minimal system message + text-as-user-message
   */
  private anthropicCount(text: string, model: string): TokenCountResult | null {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) return null;

    try {
      const result = execSync(
        `curl -s --max-time 5 https://api.anthropic.com/v1/messages/count_tokens \\
          -H "x-api-key: ${apiKey}" \\
          -H "anthropic-version: 2023-06-01" \\
          -H "content-type: application/json" \\
          -d '${JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: text }],
          }).replace(/'/g, "'\\''")}'`,
        { encoding: 'utf-8', timeout: 6000 }
      );

      const data = JSON.parse(result);
      if (data?.input_tokens !== undefined) {
        return { tokens: data.input_tokens, provider: 'anthropic', model, isExact: true, method: 'anthropic-api:count_tokens' };
      }
    } catch (err) {
      Logger.debug(`Anthropic token count failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }

  /**
   * Count tokens via litellm Python subprocess.
   * litellm calls the provider's real tokenizer (e.g., Gemini count_tokens, etc.)
   * Requires: pip install litellm
   * Returns null if litellm not available or call fails.
   */
  private litellmCount(text: string, model: string): TokenCountResult | null {
    // Check cache first — use content hash to avoid collisions
    const textHash = createHash('sha256').update(text).digest('hex').slice(0, 16);
    const cacheKey = `${model}::${textHash}`;
    if (litellmCache.has(cacheKey)) {
      const cachedTokens = litellmCache.get(cacheKey)!;
      return { tokens: cachedTokens, provider: 'litellm', model, isExact: true, method: 'litellm' };
    }

    try {
      // Pass model and text via stdin to avoid shell injection
      const input = JSON.stringify({ model, text });
      const pythonScript = `
import json, sys
try:
    import litellm
    data = json.loads(sys.stdin.read())
    result = litellm.token_counter(model=data["model"], text=data["text"])
    print(json.dumps({"tokens": result}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
      const proc = spawnSync('python3', ['-c', pythonScript], {
        encoding: 'utf-8',
        timeout: 10000,
        input,
      });
      if (proc.status !== 0 || proc.error) return null;
      const result = proc.stdout;

      const data = JSON.parse(result);
      if (data?.tokens !== undefined) {
        // Cache the result
        if (litellmCache.size >= LITELLM_CACHE_MAX) {
          // Clear oldest half
          const keys = Array.from(litellmCache.keys());
          for (let i = 0; i < keys.length / 2; i++) litellmCache.delete(keys[i]);
        }
        litellmCache.set(cacheKey, data.tokens);
        return { tokens: data.tokens, provider: 'litellm', model, isExact: true, method: 'litellm' };
      }
    } catch (err) {
      Logger.debug(`litellm token count failed for ${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }

  countSimple(text: string): number { return this.tiktokenCount(text, 'o200k_base'); }

  private tiktokenCount(text: string, encoding: TiktokenEncoding): number {
    let enc = this.encodings.get(encoding);
    if (!enc) { enc = get_encoding(encoding); this.encodings.set(encoding, enc); }
    return enc.encode(text).length;
  }

  free(): void { for (const enc of this.encodings.values()) enc.free(); this.encodings.clear(); }
}
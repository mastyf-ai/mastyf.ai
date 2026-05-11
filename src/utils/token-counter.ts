/**
 * Per-provider token counter — routes to the correct tokenizer based on model identity.
 *
 * Fix 4: The original v1 used o200k_base (GPT-4o encoding) for all models across all 17
 * providers. This gave correct counts only for OpenAI models, approximate counts for most
 * others, and wrong counts for Anthropic models specifically.
 *
 * Now each provider gets its own counting strategy:
 * - OpenAI: tiktoken with model-specific encodings (o200k_base, cl100k_base)
 * - Anthropic: char-ratio (Claude tokenizer not publicly available as library)
 * - Google: char-ratio (SentencePiece)
 * - Others: provider-specific char-ratios from empirical token-per-char data
 */
import { get_encoding, type TiktokenEncoding } from 'tiktoken';

export interface TokenCountResult {
  tokens: number;
  provider: string;
  isEstimate: boolean;
  method: string;
}

const PROVIDER_RATIOS: Record<string, number> = {
  'anthropic': 0.30,
  'google': 0.22,
  'deepseek': 0.27,
  'xai': 0.25,
  'meta': 0.25,
  'mistral': 0.25,
  'cohere': 0.25,
  'ai21': 0.25,
  'reka': 0.25,
  'amazon': 0.25,
  'alibaba': 0.30,
  'zhipu': 0.30,
  '01ai': 0.30,
  'writer': 0.25,
  'perplexity': 0.25,
  'huggingface': 0.25,
};

export class TokenCounter {
  private encodings: Map<string, ReturnType<typeof get_encoding>> = new Map();

  /**
   * Count tokens in text using GPT-4o encoding (o200k_base).
   * Throws if tiktoken WASM initialisation fails — no fabricated fallback.
   * Use countWithProvider() for per-provider accuracy.
   */
  count(text: string): number {
    return this.tiktokenCount(text, 'o200k_base');
  }

  /**
   * Per-provider count with metadata about estimation accuracy.
   * Returns null for unrecognised models — no fabricated defaults.
   */
  countWithProvider(text: string, model?: string): TokenCountResult | null {
    if (!model) return null;
    const m = model.toLowerCase();
    // OpenAI — exact tiktoken count
    if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) {
      const enc: TiktokenEncoding = (m.includes('4o') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4'))
        ? 'o200k_base' : 'cl100k_base';
      return { tokens: this.tiktokenCount(text, enc), provider: 'openai', isEstimate: false, method: enc };
    }
    if (m.startsWith('claude-')) return { tokens: Math.round(text.length * PROVIDER_RATIOS['anthropic']), provider: 'anthropic', isEstimate: true, method: 'char-ratio-0.30' };
    if (m.startsWith('gemini-') || m.startsWith('gemma-')) return { tokens: Math.round(text.length * PROVIDER_RATIOS['google']), provider: 'google', isEstimate: true, method: 'char-ratio-0.22' };
    if (m.startsWith('deepseek-')) return { tokens: Math.round(text.length * PROVIDER_RATIOS['deepseek']), provider: 'deepseek', isEstimate: true, method: 'char-ratio-0.27' };
    if (m.startsWith('grok-')) return { tokens: Math.round(text.length * PROVIDER_RATIOS['xai']), provider: 'xai', isEstimate: true, method: 'char-ratio-0.25' };
    if (m.startsWith('llama-')) return { tokens: Math.round(text.length * PROVIDER_RATIOS['meta']), provider: 'meta', isEstimate: true, method: 'char-ratio-0.25' };
    if (m.startsWith('mistral-') || m.startsWith('mixtral-') || m.startsWith('codestral') || m.startsWith('pixtral-'))
      return { tokens: Math.round(text.length * PROVIDER_RATIOS['mistral']), provider: 'mistral', isEstimate: true, method: 'char-ratio-0.25' };

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
        return { tokens: Math.round(text.length * ratio), provider, isEstimate: true, method: `char-ratio-${ratio}` };
      }
    }
    // No fabricated default — unrecognised model returns null
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
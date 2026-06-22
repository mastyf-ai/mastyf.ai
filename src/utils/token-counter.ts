/**
 * Provider-aware token counting for cost governance.
 *
 * - OpenAI: tiktoken (o200k_base / cl100k_base) — exact in-process
 * - Anthropic: @anthropic-ai/tokenizer (optional) or chars/3.5 heuristic
 * - Google / others: litellm subprocess when available, else char-ratio
 * - Multimodal: (width × height) / 750 per image (OpenAI-style tile rule)
 * - API usage: prefers usage.input_tokens / output_tokens from responses
 */
import { get_encoding, type TiktokenEncoding } from 'tiktoken';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import https from 'https';
import { Logger } from './logger.js';

const requireOptional = createRequire(import.meta.url);

export type TokenProvider = 'openai' | 'anthropic' | 'google' | 'unknown';
export type TokenSource = 'api' | 'estimated';

export interface TokenCountResult {
  tokens: number;
  provider: string;
  model?: string;
  isExact: boolean;
  method: string;
  tokenSource?: TokenSource;
}

export interface ApiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProxyTokenCounts {
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  tokenSource: TokenSource;
  requestTokenSource: TokenSource;
  responseTokenSource: TokenSource;
  imageTokens: number;
  audioTokens: number;
  method?: string;
}

const PROVIDER_RATIOS: Record<string, number> = {
  anthropic: 1 / 3.5,
  google: 0.22,
  deepseek: 0.27,
  xai: 0.25,
  meta: 0.25,
  mistral: 0.25,
  cohere: 0.25,
  ai21: 0.25,
  reka: 0.25,
  amazon: 0.25,
  alibaba: 0.30,
  zhipu: 0.30,
  '01ai': 0.30,
  writer: 0.25,
  perplexity: 0.25,
  huggingface: 0.25,
};

const IMAGE_TOKENS_DIVISOR = 750;
/** Whisper-style heuristic: ~25 tokens per second of audio (documented drift vs provider billing). */
const AUDIO_TOKENS_PER_SECOND = 25;
const DRIFT_LOG_THRESHOLD = 0.05;

const litellmCache = new Map<string, number>();
const LITELLM_CACHE_MAX = 1000;

let anthropicTokenizer: { countTokens: (text: string) => number } | null | undefined;

/** Detect LLM provider from model id string. */
export function detectProvider(modelId: string): TokenProvider {
  const m = modelId.toLowerCase();
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) {
    return 'openai';
  }
  if (m.startsWith('claude-')) return 'anthropic';
  if (m.startsWith('gemini-') || m.startsWith('gemma-')) return 'google';
  return 'unknown';
}

/** OpenAI-style image token estimate: (width × height) / 750 per image. */
export function imageTokensFromDimensions(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 0;
  }
  return Math.ceil((width * height) / IMAGE_TOKENS_DIVISOR);
}

/** Recursively scan payload for images and sum token estimates. */
export function countImageTokensInPayload(payload: unknown, seen = new WeakSet<object>()): number {
  if (payload == null) return 0;
  if (typeof payload !== 'object') return 0;
  if (seen.has(payload as object)) return 0;
  seen.add(payload as object);

  let total = 0;
  const obj = payload as Record<string, unknown>;

  const w = obj.width ?? obj.image_width;
  const h = obj.height ?? obj.image_height;
  if (typeof w === 'number' && typeof h === 'number') {
    total += imageTokensFromDimensions(w, h);
  }

  if (obj.type === 'image' || obj.type === 'image_url') {
    const detail = obj.detail as string | undefined;
    if (detail === 'low') {
      total += imageTokensFromDimensions(512, 512);
    } else if (typeof w === 'number' && typeof h === 'number') {
      total += imageTokensFromDimensions(w, h);
    } else if (typeof obj.url === 'string' && obj.url.startsWith('data:image')) {
      total += imageTokensFromDimensions(1024, 1024);
    }
  }

  if (typeof obj.image_url === 'object' && obj.image_url !== null) {
    total += countImageTokensInPayload(obj.image_url, seen);
  }
  if (typeof obj.source === 'object' && obj.source !== null) {
    const src = obj.source as Record<string, unknown>;
    if (src.type === 'base64' && typeof src.data === 'string') {
      total += imageTokensFromDimensions(1024, 1024);
    }
  }
  if (typeof obj.url === 'string' && obj.url.startsWith('data:image')) {
    total += imageTokensFromDimensions(1024, 1024);
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      total += countImageTokensInPayload(item, seen);
    }
    return total;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      total += countImageTokensInPayload(value, seen);
    }
  }
  return total;
}

export function estimateAudioTokens(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.ceil(durationSeconds * AUDIO_TOKENS_PER_SECOND);
}

/** Recursively scan payload for audio duration fields and sum token estimates. */
export function countAudioTokensInPayload(payload: unknown, seen = new WeakSet<object>()): number {
  if (payload == null) return 0;
  if (typeof payload !== 'object') return 0;
  if (seen.has(payload as object)) return 0;
  seen.add(payload as object);

  let total = 0;
  const obj = payload as Record<string, unknown>;

  const durationKeys = [
    'duration_seconds',
    'durationSeconds',
    'audio_duration',
    'audioDuration',
  ] as const;
  for (const key of durationKeys) {
    const v = obj[key];
    if (typeof v === 'number') total += estimateAudioTokens(v);
  }
  if (typeof obj.duration_ms === 'number') {
    total += estimateAudioTokens(obj.duration_ms / 1000);
  }
  if (typeof obj.durationMs === 'number') {
    total += estimateAudioTokens(obj.durationMs / 1000);
  }
  if (obj.type === 'audio' || obj.type === 'input_audio') {
    const dur = obj.duration ?? obj.duration_seconds;
    if (typeof dur === 'number') total += estimateAudioTokens(dur);
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      total += countAudioTokensInPayload(item, seen);
    }
    return total;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      total += countAudioTokensInPayload(value, seen);
    }
  }
  return total;
}

/** Extract provider usage block from JSON-RPC or nested metadata. */
export function extractApiUsage(payload: unknown): ApiUsage | null {
  if (!payload || typeof payload !== 'object') return null;
  const stack: unknown[] = [payload];
  const seen = new Set<object>();

  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur as object)) continue;
    seen.add(cur as object);
    const o = cur as Record<string, unknown>;

    const usage = o.usage;
    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>;
      const input =
        (typeof u.input_tokens === 'number' ? u.input_tokens : undefined) ??
        (typeof u.prompt_tokens === 'number' ? u.prompt_tokens : undefined);
      const output =
        (typeof u.output_tokens === 'number' ? u.output_tokens : undefined) ??
        (typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined);
      if (input !== undefined && output !== undefined) {
        return { inputTokens: input, outputTokens: output };
      }
    }

    for (const key of ['result', 'params', '_meta', 'metadata']) {
      const child = o[key];
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return null;
}

/** Log when API-reported tokens diverge from estimate by more than 5%. */
export function logTokenDriftIfNeeded(
  estimated: number,
  actual: number,
  context: string,
): void {
  if (estimated <= 0 || actual <= 0) return;
  const drift = Math.abs(actual - estimated) / Math.max(estimated, actual);
  if (drift > DRIFT_LOG_THRESHOLD) {
    Logger.warn(
      `[token-counter] ${context}: estimate=${estimated} api=${actual} drift=${(drift * 100).toFixed(1)}%`,
    );
  }
}

export class TokenCounter {
  private encodings: Map<string, ReturnType<typeof get_encoding>> = new Map();

  count(text: string): number {
    return this.tiktokenCount(text, 'o200k_base');
  }

  countWithProvider(text: string, model?: string): TokenCountResult | null {
    if (!model) return null;
    const m = model.toLowerCase();
    const provider = detectProvider(model);

    if (provider === 'openai') {
      const enc: TiktokenEncoding =
        m.includes('4o') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')
          ? 'o200k_base'
          : 'cl100k_base';
      return {
        tokens: this.tiktokenCount(text, enc),
        provider: 'openai',
        model,
        isExact: true,
        method: `tiktoken:${enc}`,
        tokenSource: 'estimated',
      };
    }

    if (provider === 'anthropic') {
      const anthropicResult = this.anthropicCountLocal(text, model);
      if (anthropicResult) return anthropicResult;
      const apiResult = this.anthropicCountApi(text, model);
      if (apiResult) return apiResult;
      return {
        tokens: Math.round(text.length * PROVIDER_RATIOS.anthropic),
        provider: 'anthropic',
        model,
        isExact: false,
        method: 'char-ratio-1/3.5',
        tokenSource: 'estimated',
      };
    }

    if (provider === 'google') {
      const litellmResult = this.litellmCount(text, model);
      if (litellmResult) return litellmResult;
      return {
        tokens: Math.round(text.length * PROVIDER_RATIOS.google),
        provider: 'google',
        model,
        isExact: false,
        method: 'char-ratio-0.22',
        tokenSource: 'estimated',
      };
    }

    const litellmResult = this.litellmCount(text, model);
    if (litellmResult) return litellmResult;

    if (m.startsWith('deepseek-')) {
      return {
        tokens: Math.round(text.length * PROVIDER_RATIOS.deepseek),
        provider: 'deepseek',
        model,
        isExact: false,
        method: 'char-ratio-0.27',
        tokenSource: 'estimated',
      };
    }
    if (m.startsWith('grok-')) {
      return {
        tokens: Math.round(text.length * PROVIDER_RATIOS.xai),
        provider: 'xai',
        model,
        isExact: false,
        method: 'char-ratio-0.25',
        tokenSource: 'estimated',
      };
    }
    if (m.startsWith('llama-')) {
      return {
        tokens: Math.round(text.length * PROVIDER_RATIOS.meta),
        provider: 'meta',
        model,
        isExact: false,
        method: 'char-ratio-0.25',
        tokenSource: 'estimated',
      };
    }
    if (
      m.startsWith('mistral-') ||
      m.startsWith('mixtral-') ||
      m.startsWith('codestral') ||
      m.startsWith('pixtral-')
    ) {
      return {
        tokens: Math.round(text.length * PROVIDER_RATIOS.mistral),
        provider: 'mistral',
        model,
        isExact: false,
        method: 'char-ratio-0.25',
        tokenSource: 'estimated',
      };
    }

    return {
      tokens: this.tiktokenCount(text, 'o200k_base'),
      provider: 'unknown',
      model,
      isExact: false,
      method: 'tiktoken:o200k_base-fallback',
      tokenSource: 'estimated',
    };
  }

  /**
   * Count tokens for a proxied tools/call (request + response), preferring API usage.
   */
  countProxyCall(options: {
    requestText: string;
    responseText: string;
    model?: string;
    requestPayload?: unknown;
    responsePayload?: unknown;
  }): ProxyTokenCounts {
    const { requestText, responseText, model, requestPayload, responsePayload } = options;
    const imageTokens =
      countImageTokensInPayload(requestPayload) + countImageTokensInPayload(responsePayload);
    const audioTokens =
      countAudioTokensInPayload(requestPayload) + countAudioTokensInPayload(responsePayload);
    const multimodalTokens = imageTokens + audioTokens;

    const reqEstimate = this.estimateTextTokens(requestText, model);
    const resEstimate = this.estimateTextTokens(responseText, model);

    const reqUsage = extractApiUsage(requestPayload);
    const resUsage = extractApiUsage(responsePayload);
    const combinedUsage = extractApiUsage(responsePayload) ?? extractApiUsage(requestPayload);

    let requestTokens = reqEstimate.tokens + multimodalTokens;
    let responseTokens = resEstimate.tokens;
    let requestTokenSource: TokenSource = 'estimated';
    let responseTokenSource: TokenSource = 'estimated';

    if (reqUsage?.inputTokens !== undefined) {
      logTokenDriftIfNeeded(requestTokens, reqUsage.inputTokens, 'request input_tokens');
      requestTokens = reqUsage.inputTokens + multimodalTokens;
      requestTokenSource = 'api';
    } else if (combinedUsage?.inputTokens !== undefined) {
      logTokenDriftIfNeeded(requestTokens, combinedUsage.inputTokens, 'combined input_tokens');
      requestTokens = combinedUsage.inputTokens + multimodalTokens;
      requestTokenSource = 'api';
    }

    if (resUsage?.outputTokens !== undefined) {
      logTokenDriftIfNeeded(responseTokens, resUsage.outputTokens, 'response output_tokens');
      responseTokens = resUsage.outputTokens;
      responseTokenSource = 'api';
    } else if (combinedUsage?.outputTokens !== undefined) {
      logTokenDriftIfNeeded(responseTokens, combinedUsage.outputTokens, 'combined output_tokens');
      responseTokens = combinedUsage.outputTokens;
      responseTokenSource = 'api';
    }

    const tokenSource: TokenSource =
      requestTokenSource === 'api' || responseTokenSource === 'api' ? 'api' : 'estimated';

    return {
      requestTokens,
      responseTokens,
      totalTokens: requestTokens + responseTokens,
      tokenSource,
      requestTokenSource,
      responseTokenSource,
      imageTokens,
      audioTokens,
      method: reqEstimate.method,
    };
  }

  private estimateTextTokens(text: string, model?: string): TokenCountResult {
    if (model) {
      const r = this.countWithProvider(text, model);
      if (r) return r;
    }
    return {
      tokens: this.tiktokenCount(text, 'o200k_base'),
      provider: 'openai',
      isExact: false,
      method: 'tiktoken:o200k_base-default',
      tokenSource: 'estimated',
    };
  }

  private anthropicCountLocal(text: string, model: string): TokenCountResult | null {
    const counted = countAnthropicTokensSync(text);
    if (counted === null) return null;
    return {
      tokens: counted,
      provider: 'anthropic',
      model,
      isExact: true,
      method: '@anthropic-ai/tokenizer',
      tokenSource: 'estimated',
    };
  }

  private anthropicCountApi(text: string, model: string): TokenCountResult | null {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) return null;

    try {
      const payload = JSON.stringify({
        model,
        messages: [{ role: 'user', content: text }],
      });

      const workerScript = `
const https = require('https');
const payload = process.env.ANTHROPIC_PAYLOAD;
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!payload || !apiKey) {
  process.stderr.write('Missing payload or API key');
  process.exit(1);
}
const req = https.request(
  {
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages/count_tokens',
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    },
    timeout: 6000,
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk.toString('utf-8'); });
    res.on('end', () => {
      process.stdout.write(data);
    });
  }
);
req.on('timeout', () => {
  req.destroy(new Error('timeout'));
});
req.on('error', (err) => {
  process.stderr.write(String(err && err.message ? err.message : err));
  process.exit(1);
});
req.write(payload);
req.end();
`;

      const child = spawnSync(process.execPath, ['-e', workerScript], {
        encoding: 'utf-8',
        timeout: 6500,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: apiKey,
          ANTHROPIC_PAYLOAD: payload,
        },
      });

      if (child.status !== 0) {
        throw new Error(child.stderr || `anthropic counter subprocess failed with status ${String(child.status)}`);
      }

      const data = JSON.parse(child.stdout || '{}');
      if (data?.input_tokens !== undefined) {
        return {
          tokens: data.input_tokens,
          provider: 'anthropic',
          model,
          isExact: true,
          method: 'anthropic-api:count_tokens',
          tokenSource: 'estimated',
        };
      }
    } catch (err) {
      Logger.debug(
        `Anthropic API token count failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }

  private litellmCount(text: string, model: string): TokenCountResult | null {
    const textHash = createHash('sha256').update(text).digest('hex').slice(0, 16);
    const cacheKey = `${model}::${textHash}`;
    if (litellmCache.has(cacheKey)) {
      const cachedTokens = litellmCache.get(cacheKey)!;
      return {
        tokens: cachedTokens,
        provider: 'litellm',
        model,
        isExact: true,
        method: 'litellm',
        tokenSource: 'estimated',
      };
    }

    try {
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
      const data = JSON.parse(proc.stdout);
      if (data?.tokens !== undefined) {
        if (litellmCache.size >= LITELLM_CACHE_MAX) {
          const keys = Array.from(litellmCache.keys());
          for (let i = 0; i < keys.length / 2; i++) litellmCache.delete(keys[i]);
        }
        litellmCache.set(cacheKey, data.tokens);
        return {
          tokens: data.tokens,
          provider: 'litellm',
          model,
          isExact: true,
          method: 'litellm',
          tokenSource: 'estimated',
        };
      }
    } catch (err) {
      Logger.debug(
        `litellm token count failed for ${model}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }

  countSimple(text: string): number {
    return this.tiktokenCount(text, 'o200k_base');
  }

  private tiktokenCount(text: string, encoding: TiktokenEncoding): number {
    let enc = this.encodings.get(encoding);
    if (!enc) {
      enc = get_encoding(encoding);
      this.encodings.set(encoding, enc);
    }
    return enc.encode(text).length;
  }

  free(): void {
    for (const enc of this.encodings.values()) enc.free();
    this.encodings.clear();
  }
}

/** Extract model id from MCP tools/call message shape. */
export function extractModelFromPayload(msg: unknown): string | undefined {
  if (!msg || typeof msg !== 'object') return undefined;
  const m = msg as Record<string, unknown>;
  const params = m.params as Record<string, unknown> | undefined;
  if (!params) return undefined;
  const meta = params._meta as Record<string, unknown> | undefined;
  if (typeof meta?.model === 'string' && meta.model.trim()) return meta.model.trim();
  if (typeof meta?.modelId === 'string' && meta.modelId.trim()) return meta.modelId.trim();
  if (typeof params.model === 'string' && params.model.trim()) return params.model.trim();
  const args = params.arguments;
  if (args && typeof args === 'object') {
    const a = args as Record<string, unknown>;
    if (typeof a.model === 'string' && a.model.trim()) return a.model.trim();
    if (typeof a.modelId === 'string' && a.modelId.trim()) return a.modelId.trim();
  }
  return undefined;
}

/** Lazy-load optional @anthropic-ai/tokenizer; returns null when unavailable. */
export function countAnthropicTokensSync(text: string): number | null {
  if (anthropicTokenizer === undefined) {
    try {
      const mod = requireOptional('@anthropic-ai/tokenizer') as { countTokens: (t: string) => number };
      anthropicTokenizer = mod;
    } catch {
      anthropicTokenizer = null;
    }
  }
  if (!anthropicTokenizer) return null;
  try {
    return anthropicTokenizer.countTokens(text);
  } catch {
    return null;
  }
}

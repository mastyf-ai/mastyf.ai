import { describe, it, expect } from 'vitest';
import {
  TokenCounter,
  detectProvider,
  countImageTokensInPayload,
  extractApiUsage,
  imageTokensFromDimensions,
  countAnthropicTokensSync,
} from '../../src/utils/token-counter.js';

const SAMPLE = [
  'The quick brown fox jumps over the lazy dog.',
  'Pack my box with five dozen liquor jugs.',
  'How vexingly quick daft zebras jump!',
  'The five boxing wizards jump quickly.',
  'Sphinx of black quartz, judge my vow.',
].join(' ');

describe('detectProvider', () => {
  it('classifies OpenAI, Anthropic, and Google model ids', () => {
    expect(detectProvider('gpt-4o')).toBe('openai');
    expect(detectProvider('o3-mini')).toBe('openai');
    expect(detectProvider('claude-3-5-sonnet-20241022')).toBe('anthropic');
    expect(detectProvider('gemini-2.0-flash')).toBe('google');
    expect(detectProvider('deepseek-chat')).toBe('unknown');
  });
});

describe('TokenCounter provider-aware counts', () => {
  const counter = new TokenCounter();

  it('OpenAI and Anthropic counts differ on the same string', () => {
    const openai = counter.countWithProvider(SAMPLE, 'gpt-4o');
    const anthropicHeuristic = counter.countWithProvider(SAMPLE, 'claude-3-5-sonnet');
    expect(openai).not.toBeNull();
    expect(anthropicHeuristic).not.toBeNull();
    expect(openai!.tokens).not.toBe(anthropicHeuristic!.tokens);
    expect(openai!.provider).toBe('openai');
    expect(anthropicHeuristic!.provider).toBe('anthropic');
  });

  it('uses chars/3.5 heuristic for Claude when tokenizer package is absent', () => {
    const result = counter.countWithProvider(SAMPLE, 'claude-3-5-sonnet');
    const expected = Math.round(SAMPLE.length / 3.5);
    const hasTokenizer = countAnthropicTokensSync(SAMPLE) !== null;
    if (!hasTokenizer) {
      expect(result?.method).toMatch(/char-ratio|tokenizer/);
      if (result?.method === 'char-ratio-1/3.5') {
        expect(result.tokens).toBe(expected);
      }
    }
  });

  counter.free();
});

describe('image token math', () => {
  it('applies (width * height) / 750 per image', () => {
    expect(imageTokensFromDimensions(1024, 1024)).toBe(Math.ceil((1024 * 1024) / 750));
  });

  it('adds image tokens from multimodal fixture payload', () => {
    const payload = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,abc' },
            },
            { type: 'image', width: 512, height: 512 },
          ],
        },
      ],
    };
    const tokens = countImageTokensInPayload(payload);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeGreaterThanOrEqual(imageTokensFromDimensions(512, 512));
  });
});

describe('extractApiUsage', () => {
  it('reads Anthropic/OpenAI usage blocks from nested metadata', () => {
    const payload = {
      jsonrpc: '2.0',
      result: {
        content: [{ type: 'text', text: 'ok' }],
        _meta: { usage: { input_tokens: 1200, output_tokens: 340 } },
      },
    };
    expect(extractApiUsage(payload)).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });
});

describe('countProxyCall API override', () => {
  const counter = new TokenCounter();

  it('prefers API usage over text estimate', () => {
    const longText = 'word '.repeat(5000);
    const estimateOnly = counter.countProxyCall({
      requestText: longText,
      responseText: longText,
      model: 'claude-3-5-sonnet',
    });
    const withApi = counter.countProxyCall({
      requestText: longText,
      responseText: longText,
      model: 'claude-3-5-sonnet',
      responsePayload: {
        result: { usage: { input_tokens: 100, output_tokens: 50 } },
      },
    });
    expect(withApi.tokenSource).toBe('api');
    expect(withApi.requestTokens).toBe(100);
    expect(withApi.responseTokens).toBe(50);
    expect(withApi.requestTokens).toBeLessThan(estimateOnly.requestTokens);
    expect(withApi.responseTokens).toBeLessThan(estimateOnly.responseTokens);
  });

  counter.free();
});

import { describe, it, expect } from 'vitest';
import { TokenCounter, countImageTokensInPayload } from '../../src/utils/token-counter.js';

const MULTIMODAL_FIXTURE = {
  method: 'tools/call',
  params: {
    name: 'analyze_image',
    arguments: {
      prompt: 'What is in this image?',
      attachments: [
        { width: 1536, height: 1024 },
        {
          type: 'image_url',
          image_url: { url: 'data:image/jpeg;base64,/9j/placeholder' },
        },
      ],
    },
    _meta: { model: 'gpt-4o' },
  },
};

describe('multimodal cost tokens', () => {
  it('includes image tokens in proxy call totals for gpt-4o', () => {
    const counter = new TokenCounter();
    const imageTokens = countImageTokensInPayload(MULTIMODAL_FIXTURE);
    const textOnly = counter.countProxyCall({
      requestText: JSON.stringify({ params: { arguments: { prompt: 'What is in this image?' } } }),
      responseText: '{"result":{"content":[]}}',
      model: 'gpt-4o',
    });
    const withImages = counter.countProxyCall({
      requestText: JSON.stringify(MULTIMODAL_FIXTURE),
      responseText: '{"result":{"content":[]}}',
      model: 'gpt-4o',
      requestPayload: MULTIMODAL_FIXTURE,
    });
    expect(imageTokens).toBeGreaterThan(0);
    expect(withImages.requestTokens).toBeGreaterThan(textOnly.requestTokens);
    expect(withImages.requestTokens - textOnly.requestTokens).toBeGreaterThanOrEqual(imageTokens);
    counter.free();
  });
});

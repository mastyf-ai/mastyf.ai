import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isSemanticLlmConfigured,
  isSemanticStrictMode,
  reportSemanticDegradation,
  resetSemanticDegradationLogForTests,
} from '../../src/utils/semantic-layer.js';
import { resetLlmConfigForTests } from '../../src/config/llm-config.js';

describe('semantic-layer', () => {
  const env = { ...process.env };

  beforeEach(() => {
    resetSemanticDegradationLogForTests();
    resetLlmConfigForTests();
  });

  afterEach(() => {
    process.env = { ...env };
    resetLlmConfigForTests();
    resetSemanticDegradationLogForTests();
  });

  it('isSemanticLlmConfigured is false without API keys', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GUARDIAN_LLM_PROVIDER = 'anthropic';
    expect(isSemanticLlmConfigured()).toBe(false);
  });

  it('isSemanticStrictMode respects GUARDIAN_SEMANTIC_STRICT', () => {
    process.env.GUARDIAN_SEMANTIC_STRICT = 'true';
    expect(isSemanticStrictMode()).toBe(true);
  });

  it('reportSemanticDegradation is idempotent per reason', () => {
    expect(() => reportSemanticDegradation('test_reason')).not.toThrow();
    expect(() => reportSemanticDegradation('test_reason')).not.toThrow();
  });
});

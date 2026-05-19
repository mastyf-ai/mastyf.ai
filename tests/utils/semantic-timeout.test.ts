import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getInstantLlmTimeoutMs,
  getSemanticTimeoutMs,
  withSemanticTimeout,
} from '../../src/utils/semantic-timeout.js';

describe('semantic-timeout', () => {
  const prev = process.env.GUARDIAN_SEMANTIC_TIMEOUT_MS;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (prev === undefined) delete process.env.GUARDIAN_SEMANTIC_TIMEOUT_MS;
    else process.env.GUARDIAN_SEMANTIC_TIMEOUT_MS = prev;
  });

  it('defaults to 500ms', () => {
    delete process.env.GUARDIAN_SEMANTIC_TIMEOUT_MS;
    expect(getSemanticTimeoutMs()).toBe(500);
  });

  it('instant LLM timeout defaults to 500ms', () => {
    delete process.env.GUARDIAN_AI_INSTANT_LLM_TIMEOUT_MS;
    expect(getInstantLlmTimeoutMs()).toBe(500);
  });

  it('respects GUARDIAN_AI_INSTANT_LLM_TIMEOUT_MS', () => {
    process.env.GUARDIAN_AI_INSTANT_LLM_TIMEOUT_MS = '250';
    expect(getInstantLlmTimeoutMs()).toBe(250);
  });

  it('respects GUARDIAN_SEMANTIC_TIMEOUT_MS', () => {
    process.env.GUARDIAN_SEMANTIC_TIMEOUT_MS = '1200';
    expect(getSemanticTimeoutMs()).toBe(1200);
  });

  it('returns fallback on slow operation', async () => {
    process.env.GUARDIAN_SEMANTIC_TIMEOUT_MS = '100';
    const promise = withSemanticTimeout(
      'test',
      () => new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 500)),
      'fallback',
      100,
    );
    await vi.advanceTimersByTimeAsync(150);
    await expect(promise).resolves.toBe('fallback');
  });

  it('returns result when fast enough', async () => {
    const promise = withSemanticTimeout(
      'fast',
      async () => 'done',
      'fallback',
      500,
    );
    await expect(promise).resolves.toBe('done');
  });
});

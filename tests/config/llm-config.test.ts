import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getLlmConfig,
  resetLlmConfigForTests,
  resolveModelId,
  resolveModelIdForServer,
  extractModelFromServerArgs,
} from '../../src/config/llm-config.js';

describe('llm-config', () => {
  const keys = [
    'GUARDIAN_LLM_PROVIDER',
    'GUARDIAN_LLM_MODEL',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'OLLAMA_BASE_URL',
    'GUARDIAN_LLM_MAX_TOKENS',
    'GUARDIAN_LLM_TIMEOUT_MS',
    'GUARDIAN_LLM_TEMPERATURE',
    'GUARDIAN_MODEL',
  ] as const;

  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    resetLlmConfigForTests();
  });

  afterEach(() => {
    resetLlmConfigForTests();
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('defaults provider to anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    delete process.env.GUARDIAN_LLM_PROVIDER;
    delete process.env.GUARDIAN_LLM_MODEL;
    resetLlmConfigForTests();
    expect(getLlmConfig().provider).toBe('anthropic');
    expect(getLlmConfig().model).toContain('claude');
  });

  it('respects GUARDIAN_LLM_PROVIDER=ollama', () => {
    process.env.GUARDIAN_LLM_PROVIDER = 'ollama';
    process.env.GUARDIAN_LLM_MODEL = 'llama3';
    const cfg = getLlmConfig();
    expect(cfg.provider).toBe('ollama');
    expect(cfg.model).toBe('llama3');
    expect(cfg.ollamaBaseUrl).toMatch(/localhost/);
  });

  it('reads max tokens, timeout, and temperature from env', () => {
    process.env.GUARDIAN_LLM_MAX_TOKENS = '2048';
    process.env.GUARDIAN_LLM_TIMEOUT_MS = '15000';
    process.env.GUARDIAN_LLM_TEMPERATURE = '0.5';
    const cfg = getLlmConfig();
    expect(cfg.maxTokens).toBe(2048);
    expect(cfg.timeoutMs).toBe(15000);
    expect(cfg.temperature).toBe(0.5);
  });

  it('resolveModelId prefers payload then GUARDIAN_MODEL then config default', () => {
    process.env.GUARDIAN_LLM_PROVIDER = 'openai';
    process.env.GUARDIAN_LLM_MODEL = 'gpt-4o-mini';
    expect(resolveModelId('from-payload')).toBe('from-payload');
    delete process.env.GUARDIAN_MODEL;
    expect(resolveModelId()).toBe('gpt-4o-mini');
    process.env.GUARDIAN_MODEL = 'gpt-4o';
    expect(resolveModelId()).toBe('gpt-4o');
  });

  it('resolveModelIdForServer prefers server env and GUARDIAN_MODEL_<SERVER>', () => {
    process.env.GUARDIAN_LLM_MODEL = 'gpt-4o-mini';
    expect(resolveModelIdForServer('my-server', { GUARDIAN_MODEL: 'claude-3-5-sonnet' })).toBe(
      'claude-3-5-sonnet',
    );
    delete process.env.GUARDIAN_MODEL_MY_SERVER;
    process.env.GUARDIAN_MODEL_MY_SERVER = 'gpt-4o';
    expect(resolveModelIdForServer('my-server')).toBe('gpt-4o');
  });

  it('resolveModelIdForServer reads --model from server args', () => {
    expect(resolveModelIdForServer('srv', {}, ['run', '--model', 'claude-sonnet-4'])).toBe(
      'claude-sonnet-4',
    );
    expect(extractModelFromServerArgs(['--model=gpt-4o'])).toBe('gpt-4o');
  });

  it('resolveModelId reads CURSOR_MODEL from env', () => {
    for (const k of keys) delete process.env[k];
    process.env.CURSOR_MODEL = 'cursor-fast';
    resetLlmConfigForTests();
    expect(resolveModelId()).toBe('cursor-fast');
    delete process.env.CURSOR_MODEL;
  });
});

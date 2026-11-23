import { describe, expect, it } from 'vitest';
import { checkLocalModel, hasModel } from '../../src/ai/local-model-status.js';

const llm = { isAvailable: () => true, getModel: () => 'qwen3:8b', getOllamaUrl: () => 'http://localhost:11434' };
const answer = (models: string[], ok = true) => (async () => ({ ok, json: async () => ({ models: models.map((name) => ({ name })) }) })) as unknown as typeof fetch;
const refused = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;

describe('checkLocalModel', () => {
  it('is ready only when Ollama answers and has the model', async () => {
    expect(await checkLocalModel({ llm, fetchImpl: answer(['qwen3:8b']) })).toMatchObject({ ok: true, state: 'ready' });
  });
  it('asks for the model when Ollama runs without it', async () => {
    const s = await checkLocalModel({ llm, fetchImpl: answer(['llama3:8b']) });
    expect(s).toMatchObject({ ok: false, state: 'model-missing' });
    expect(s.reason).toContain('ollama pull qwen3:8b');
  });
  it('tells a stopped Ollama from one that was never installed', async () => {
    expect((await checkLocalModel({ llm, fetchImpl: refused, installed: () => true })).state).toBe('not-running');
    const s = await checkLocalModel({ llm, fetchImpl: refused, installed: () => false });
    expect(s.state).toBe('not-installed');
    expect(s.reason).toContain('https://ollama.com/download');
  });
  it('says when the local model is turned off', async () => {
    expect((await checkLocalModel({ llm: { ...llm, isAvailable: () => false }, fetchImpl: refused })).state).toBe('disabled');
  });
});

describe('hasModel', () => {
  it('treats an untagged model as latest', () => {
    expect(hasModel(['mistral:latest'], 'mistral')).toBe(true);
    expect(hasModel(['qwen3:14b'], 'qwen3:8b')).toBe(false);
  });
});

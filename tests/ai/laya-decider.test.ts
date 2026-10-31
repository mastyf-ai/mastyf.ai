import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyRequestWithLaya,
  isLayaDeciderEnabled,
  LAYA_VERDICT_QUESTION,
  layaRequestState,
} from '../../src/ai/laya-decider.js';
import { LAYA_VERDICT_QUESTION as CLOUD_VERDICT_QUESTION } from '../../apps/cloud/lib/laya/verdict-question.js';

function layaReply(choice: string, confidence: number, status = 200): Response {
  return new Response(
    JSON.stringify({ model: 'mastyf', answers: { verdict: { type: 'choice', choice, answer_confidence: confidence } } }),
    { status },
  );
}

describe('laya-decider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('the input matches what the model was trained on', () => {
    // Reference strings printed by the (private) training formatter.
    it('writes JSON the way Python json.dumps did for the training data', () => {
      expect(
        layaRequestState('search', {
          query: 'weather in Zürich',
          n: 3,
          nested: { a: [1, 2, { b: null }], ok: true },
          empty: {},
          list: [],
        }),
      ).toBe(
        'MCP tool call\nTool: search\nArguments: {"query": "weather in Zürich", "n": 3, "nested": {"a": [1, 2, {"b": null}], "ok": true}, "empty": {}, "list": []}',
      );
    });

    it('escapes strings the same way', () => {
      expect(layaRequestState('write_note', { text: 'line1\nline2 "q" \\ tab\t\u0001', score: 0.5 })).toBe(
        'MCP tool call\nTool: write_note\nArguments: {"text": "line1\\nline2 \\"q\\" \\\\ tab\\t\\u0001", "score": 0.5}',
      );
    });

    it('the proxy and the cloud ask the same verdict question', () => {
      expect(CLOUD_VERDICT_QUESTION).toEqual(LAYA_VERDICT_QUESTION);
    });

    // The training pipeline is private, so this check runs only where it is checked out.
    const trainedQuestions = join(process.cwd(), 'ml', 'laya', 'questions.json');
    it.skipIf(!existsSync(trainedQuestions))('asks the verdict question exactly as it was trained', () => {
      const trained = JSON.parse(readFileSync(trainedQuestions, 'utf-8'));
      expect(LAYA_VERDICT_QUESTION).toEqual(trained.verdict);
    });
  });

  describe('switching', () => {
    it('is on when the Laya service is configured', () => {
      vi.stubEnv('MASTYF_AI_LAYA_URL', 'http://127.0.0.1:8000');
      expect(isLayaDeciderEnabled()).toBe(true);
    });

    it('is off without a service, or when switched back to the LLM', () => {
      vi.stubEnv('MASTYF_AI_LAYA_URL', '');
      expect(isLayaDeciderEnabled()).toBe(false);
      vi.stubEnv('MASTYF_AI_LAYA_URL', 'http://127.0.0.1:8000');
      vi.stubEnv('MASTYF_AI_SEMANTIC_DECIDER', 'llm');
      expect(isLayaDeciderEnabled()).toBe(false);
    });
  });

  describe('classifyRequestWithLaya', () => {
    it('asks only the verdict, at the URL as given, and reads the answer', async () => {
      vi.stubEnv('MASTYF_AI_LAYA_URL', 'https://www.mastyf.ai/api/v1/laya/classify');
      vi.stubEnv('MASTYF_AI_LAYA_API_KEY', 'test-key');
      const fetchMock = vi.fn(async () => layaReply('unsafe', 0.97));
      vi.stubGlobal('fetch', fetchMock);

      const out = await classifyRequestWithLaya('run_command', { cmd: 'cat /etc/passwd' });

      expect(out).toMatchObject({ unsafe: true, confidence: 0.97 });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://www.mastyf.ai/api/v1/laya/classify');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
      const body = JSON.parse(String(init.body));
      expect(Object.keys(body.questions)).toEqual(['verdict']);
      expect(body.state).toBe('MCP tool call\nTool: run_command\nArguments: {"cmd": "cat /etc/passwd"}');
    });

    it('sends no model', async () => {
      vi.stubEnv('MASTYF_AI_LAYA_URL', 'https://www.mastyf.ai/api/v1/laya/classify');
      vi.stubEnv('MASTYF_AI_LAYA_MODEL', 'other');
      const fetchMock = vi.fn(async () => layaReply('safe', 0.95));
      vi.stubGlobal('fetch', fetchMock);
      await classifyRequestWithLaya('t', {});
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect('model' in JSON.parse(String(init.body))).toBe(false);
    });

    it('posts to a self-hosted laya-serve URL unchanged', async () => {
      vi.stubEnv('MASTYF_AI_LAYA_URL', 'http://127.0.0.1:8077/v1/systemone');
      const fetchMock = vi.fn(async () => layaReply('safe', 0.95));
      vi.stubGlobal('fetch', fetchMock);
      await classifyRequestWithLaya('t', {});
      const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('http://127.0.0.1:8077/v1/systemone');
    });

    it('uses the workspace key when no Laya key is set', async () => {
      vi.stubEnv('MASTYF_AI_LAYA_URL', 'https://www.mastyf.ai/api/v1/laya/classify');
      vi.stubEnv('MASTYF_AI_LAYA_API_KEY', '');
      vi.stubEnv('MASTYF_AI_CLOUD_API_KEY', 'gcp_x');
      const fetchMock = vi.fn(async () => layaReply('safe', 0.95));
      vi.stubGlobal('fetch', fetchMock);
      await classifyRequestWithLaya('t', {});
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer gcp_x');
    });

    describe('never sends the workspace key anywhere but the Mastyf cloud', () => {
      async function authorizationFor(url: string): Promise<string | undefined> {
        vi.stubEnv('MASTYF_AI_LAYA_URL', url);
        vi.stubEnv('MASTYF_AI_LAYA_API_KEY', '');
        vi.stubEnv('MASTYF_AI_CLOUD_API_KEY', 'gcp_x');
        const fetchMock = vi.fn(async () => layaReply('safe', 0.95));
        vi.stubGlobal('fetch', fetchMock);
        await classifyRequestWithLaya('t', {});
        const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        return (init.headers as Record<string, string>)['Authorization'];
      }

      it.each([
        ['a self-hosted laya-serve', 'http://127.0.0.1:8077/v1/systemone'],
        ['another https host', 'https://laya.example.com/api/v1/laya/classify'],
        ['a look-alike host', 'https://www.mastyf.ai.evil.example/api/v1/laya/classify'],
        ['the cloud host over http', 'http://www.mastyf.ai/api/v1/laya/classify'],
      ])('%s', async (_name, url) => {
        expect(await authorizationFor(url)).toBeUndefined();
      });

      it('follows a configured cloud URL', async () => {
        vi.stubEnv('MASTYF_AI_CLOUD_URL', 'https://cloud.acme.example');
        expect(await authorizationFor('https://cloud.acme.example/api/v1/laya/classify')).toBe('Bearer gcp_x');
      });

      it('still sends an explicit Laya key to a self-hosted server', async () => {
        vi.stubEnv('MASTYF_AI_LAYA_URL', 'http://127.0.0.1:8077/v1/systemone');
        vi.stubEnv('MASTYF_AI_LAYA_API_KEY', 'laya-key');
        vi.stubEnv('MASTYF_AI_CLOUD_API_KEY', 'gcp_x');
        const fetchMock = vi.fn(async () => layaReply('safe', 0.95));
        vi.stubGlobal('fetch', fetchMock);
        await classifyRequestWithLaya('t', {});
        const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer laya-key');
      });
    });

    it('the Laya key wins when both are set', async () => {
      vi.stubEnv('MASTYF_AI_LAYA_URL', 'https://www.mastyf.ai/api/v1/laya/classify');
      vi.stubEnv('MASTYF_AI_LAYA_API_KEY', 'laya-key');
      vi.stubEnv('MASTYF_AI_CLOUD_API_KEY', 'gcp_x');
      const fetchMock = vi.fn(async () => layaReply('safe', 0.95));
      vi.stubGlobal('fetch', fetchMock);
      await classifyRequestWithLaya('t', {});
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer laya-key');
    });

    it('returns null when the service fails, so the caller can degrade', async () => {
      vi.stubEnv('MASTYF_AI_LAYA_URL', 'http://127.0.0.1:8000');
      vi.stubGlobal('fetch', vi.fn(async () => layaReply('unsafe', 0.9, 503)));
      expect(await classifyRequestWithLaya('t', {})).toBeNull();

      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
      expect(await classifyRequestWithLaya('t', {})).toBeNull();

      vi.stubGlobal('fetch', vi.fn(async () => layaReply('maybe', 0.9)));
      expect(await classifyRequestWithLaya('t', {})).toBeNull();
    });

    it('returns null without a configured service', async () => {
      vi.stubEnv('MASTYF_AI_LAYA_URL', '');
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      expect(await classifyRequestWithLaya('t', {})).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

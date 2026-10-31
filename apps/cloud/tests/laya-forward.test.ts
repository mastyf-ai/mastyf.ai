import { afterEach, describe, expect, it, vi } from 'vitest';
import { forwardToLaya } from '../lib/laya/forward';
import { LAYA_VERDICT_QUESTION } from '../lib/laya/verdict-question';

const target = { endpoint: 'https://laya-origin.mastyf.ai/v1/systemone', secret: 'server-secret' };
const STATE = 'MCP tool call\nTool: t\nArguments: {}';

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('forwardToLaya', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends only the state and the verdict question, with the server's secret", async () => {
    const fetchMock = vi.fn(async () => reply({ answers: { verdict: { choice: 'safe', answer_confidence: 0.9 } } }));
    vi.stubGlobal('fetch', fetchMock);

    await forwardToLaya(target, STATE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(target.endpoint);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer server-secret');
    const sent = JSON.parse(String(init.body));
    expect(Object.keys(sent)).toEqual(['state', 'questions']);
    expect(sent).toEqual({ state: STATE, questions: { verdict: LAYA_VERDICT_QUESTION } });
    expect(String(init.body)).not.toMatch(/org|workspace|tenant/i);
  });

  it('reads the verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ answers: { verdict: { choice: 'unsafe', answer_confidence: 0.97 } } })));
    expect(await forwardToLaya(target, STATE)).toEqual({ ok: true, choice: 'unsafe', confidence: 0.97 });
  });

  it('fails on a non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'boom' }, 500)));
    expect(await forwardToLaya(target, STATE)).toEqual({ ok: false });
  });

  it('fails on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    expect(await forwardToLaya(target, STATE)).toEqual({ ok: false });
  });

  it('fails on a timeout', async () => {
    vi.stubEnv('LAYA_FORWARD_TIMEOUT_MS', '20');
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })));
    const started = Date.now();
    expect(await forwardToLaya(target, STATE)).toEqual({ ok: false });
    expect(Date.now() - started).toBeLessThan(200);
  });

  it.each([
    ['an unknown choice', { answers: { verdict: { choice: 'maybe', answer_confidence: 0.9 } } }],
    ['a string confidence', { answers: { verdict: { choice: 'safe', answer_confidence: '0.9' } } }],
    ['a confidence above 1', { answers: { verdict: { choice: 'safe', answer_confidence: 1.5 } } }],
    ['a negative confidence', { answers: { verdict: { choice: 'safe', answer_confidence: -0.1 } } }],
    ['no answers', { verdict: { choice: 'safe', answer_confidence: 0.9 } }],
    ['not an object', 'safe'],
  ])('fails on %s', async (_name, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(body)));
    expect(await forwardToLaya(target, STATE)).toEqual({ ok: false });
  });

  it('fails on a body that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 200 })));
    expect(await forwardToLaya(target, STATE)).toEqual({ ok: false });
  });
});

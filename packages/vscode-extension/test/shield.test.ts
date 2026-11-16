import { describe, expect, it } from 'vitest';
import { ShieldClient } from '../src/shield';

const KEY = 'k-secret-0123456789abcdef';

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ShieldClient', () => {
  it("asks Shield's local service with the key", async () => {
    const f = fakeFetch(() => json({ receipts: [{ receipt_id: 'r1', decision: 'BLOCK' }] }));
    const c = new ShieldClient({ port: 14000, readKey: () => KEY, fetchImpl: f.impl });
    expect(await c.receipts(50)).toEqual([{ receipt_id: 'r1', decision: 'BLOCK' }]);
    expect(f.calls[0].url).toBe('http://127.0.0.1:14000/api/gateway/receipts?limit=50');
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it('makes no request without a key', async () => {
    const f = fakeFetch(() => json({ receipts: [] }));
    const c = new ShieldClient({ port: 14000, readKey: () => null, fetchImpl: f.impl });
    expect(await c.receipts(50)).toBeNull();
    expect(await c.answering()).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  it('a rejected key (401) counts as Shield closed', async () => {
    const c = new ShieldClient({ port: 14000, readKey: () => KEY, fetchImpl: fakeFetch(() => json({ error: 'no' }, 401)).impl });
    expect(await c.receipts(50)).toBeNull();
    expect(await c.answering()).toBe(false);
  });

  it('something else on the port (HTML, or JSON without receipts) counts as Shield closed', async () => {
    const html = new ShieldClient({
      port: 14000,
      readKey: () => KEY,
      fetchImpl: fakeFetch(() => new Response('<html>hi</html>', { status: 200 })).impl,
    });
    expect(await html.receipts(50)).toBeNull();
    const other = new ShieldClient({ port: 14000, readKey: () => KEY, fetchImpl: fakeFetch(() => json({ hello: 1 })).impl });
    expect(await other.receipts(50)).toBeNull();
  });

  it('gives up after the timeout', async () => {
    const never = ((_: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const c = new ShieldClient({ port: 14000, readKey: () => KEY, fetchImpl: never, timeoutMs: 20 });
    expect(await c.receipts(50)).toBeNull();
  });

  it('answering() is true only when the status endpoint answers 200', async () => {
    const f = fakeFetch((url) => (url.endsWith('/api/gateway/status') ? json({ available: true }) : json({}, 404)));
    const c = new ShieldClient({ port: 14000, readKey: () => KEY, fetchImpl: f.impl });
    expect(await c.answering()).toBe(true);
    expect(f.calls[0].url).toBe('http://127.0.0.1:14000/api/gateway/status');
  });

  it('never lets the key escape in errors or results', async () => {
    const boom = (async (url: string, init?: RequestInit) => {
      throw new Error(`failed ${url} ${JSON.stringify(init?.headers)}`);
    }) as typeof fetch;
    const c = new ShieldClient({ port: 14000, readKey: () => KEY, fetchImpl: boom });
    const out = await c.receipts(50).catch((e: unknown) => String(e));
    expect(JSON.stringify(out ?? '')).not.toContain(KEY);
    expect(JSON.stringify(c)).not.toContain(KEY);
  });
});

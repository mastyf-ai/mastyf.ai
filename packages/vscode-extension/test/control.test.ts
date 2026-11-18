import { describe, expect, it } from 'vitest';
import { parseControlFile, ProtectionControl } from '../src/control';

const KEY = 'c'.repeat(43);
const FILE = JSON.stringify({ port: 51234, key: KEY });

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe("Shield's control file", () => {
  it('takes a port and a long key, and nothing else', () => {
    expect(parseControlFile(FILE)).toEqual({ port: 51234, key: KEY });
    expect(parseControlFile('not json')).toBeNull();
    expect(parseControlFile(JSON.stringify({ port: 0, key: KEY }))).toBeNull();
    expect(parseControlFile(JSON.stringify({ port: 70000, key: KEY }))).toBeNull();
    expect(parseControlFile(JSON.stringify({ port: '51234', key: KEY }))).toBeNull();
    expect(parseControlFile(JSON.stringify({ port: 51234, key: 'short' }))).toBeNull();
  });
});

describe('ProtectionControl', () => {
  it("reads whether Shield protects this PC's agents, from 127.0.0.1 with the key", async () => {
    const f = fakeFetch(() => json({ protected: false, agents: 3, unprotectedServers: 2 }));
    const c = new ProtectionControl({ readFile: () => FILE, fetchImpl: f.impl });
    expect(await c.status()).toEqual({ protected: false, agents: 3, unprotectedServers: 2 });
    expect(f.calls[0]!.url).toBe('http://127.0.0.1:51234/v1/protection');
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(f.calls[0]!.init.redirect).toBe('error');
  });

  it('asks Shield to turn protection on, and only on', async () => {
    const f = fakeFetch(() => json({ protected: true, newlyProtected: 4 }));
    const c = new ProtectionControl({ readFile: () => FILE, fetchImpl: f.impl });
    expect(await c.turnOn()).toEqual({ ok: true, newlyProtected: 4 });
    expect(f.calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ protect: true });
  });

  it('with no control file (Shield closed, or a Shield before 0.6) it sends nothing', async () => {
    const f = fakeFetch(() => json({}));
    const c = new ProtectionControl({ readFile: () => null, fetchImpl: f.impl });
    expect(await c.status()).toBeNull();
    expect(await c.turnOn()).toEqual({ ok: false, reason: 'unavailable' });
    expect(f.calls).toHaveLength(0);
  });

  it('a busy Shield, a refused key and a failure each come back as a reason, never as a throw', async () => {
    const busy = new ProtectionControl({ readFile: () => FILE, fetchImpl: fakeFetch(() => json({ error: 'Shield is already changing protection' }, 409)).impl });
    expect(await busy.turnOn()).toEqual({ ok: false, reason: 'busy' });
    const refused = new ProtectionControl({ readFile: () => FILE, fetchImpl: fakeFetch(() => json({ error: 'missing or wrong key' }, 401)).impl });
    expect(await refused.turnOn()).toEqual({ ok: false, reason: 'unavailable' });
    const failed = new ProtectionControl({ readFile: () => FILE, fetchImpl: fakeFetch(() => json({ error: 'disk full' }, 500)).impl });
    expect(await failed.turnOn()).toEqual({ ok: false, reason: 'failed' });
    const down = new ProtectionControl({
      readFile: () => FILE,
      fetchImpl: (async () => {
        throw new Error(`connect ECONNREFUSED with Bearer ${KEY}`);
      }) as typeof fetch,
    });
    const r = await down.turnOn();
    expect(r).toEqual({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

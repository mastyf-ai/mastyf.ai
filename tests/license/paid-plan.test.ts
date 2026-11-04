import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LicenseClient,
  loadLicenseClientConfig,
  resetLicenseClientForTests,
} from '../../src/license/license-client.js';

function client(reply: () => Promise<Response>, graceSeconds = 900): LicenseClient {
  return new LicenseClient({
    controlPlaneUrl: 'https://control.example',
    licenseKey: 'gcp_key',
    requireLicense: false,
    refreshSeconds: 300,
    graceSeconds,
    fetchFn: reply as unknown as typeof fetch,
  });
}

const REJECTED = () => new Response(JSON.stringify({ licensed: false, status: 'invalid_key' }), { status: 401 });

const json = (body: unknown, status = 200) => async () =>
  new Response(JSON.stringify(body), { status });

afterEach(() => {
  resetLicenseClientForTests();
  vi.unstubAllEnvs();
});

describe('LicenseClient.hasPaidPlan', () => {
  it('is false with no key or control plane', () => {
    const c = new LicenseClient({ requireLicense: false, refreshSeconds: 300, graceSeconds: 900 });
    expect(c.hasPaidPlan()).toBe(false);
  });

  it('is false before the first answer', () => {
    expect(client(json({ licensed: true, paid: true })).hasPaidPlan()).toBe(false);
  });

  it('is true when the control plane says the plan is paid', async () => {
    const c = client(json({ licensed: true, paid: true, tier: 'pro' }));
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(true);
  });

  it('is false for a valid free key, which still counts as licensed', async () => {
    const c = client(json({ licensed: true, paid: false, tier: 'free' }));
    await c.refresh();
    expect(c.isLicensed()).toBe(true);
    expect(c.hasPaidPlan()).toBe(false);
  });

  it('is false for an older control plane that does not report a plan', async () => {
    const c = client(json({ licensed: true }));
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(false);
  });

  it('accepts only the boolean true', async () => {
    const c = client(json({ licensed: true, paid: 'true' }));
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(false);
  });

  it('is not unlocked by the license bypass settings', async () => {
    vi.stubEnv('MASTYF_AI_CI_BYPASS_LICENSE', 'true');
    const c = client(json({ licensed: true, paid: false }));
    await c.refresh();
    expect(c.hasFeature('swarm')).toBe(true);
    expect(c.hasPaidPlan()).toBe(false);
  });

  it('drops to false when the plan lapses', async () => {
    const replies = [{ licensed: true, paid: true }, { licensed: true, paid: false }];
    const c = client(async () => new Response(JSON.stringify(replies.shift())));
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(true);
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(false);
  });

  it('survives a short outage after a good answer', async () => {
    let up = true;
    const c = client(async () => {
      if (!up) throw new Error('offline');
      return new Response(JSON.stringify({ licensed: true, paid: true }));
    });
    await c.refresh();
    up = false;
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(true);
    expect(c.controlPlaneUnreachable()).toBe(false);
  });

  it('keeps a running proxy protected however long an outage lasts', async () => {
    let up = true;
    const c = client(async () => {
      if (!up) throw new Error('offline');
      return new Response(JSON.stringify({ licensed: true, paid: true }));
    }, 0);
    await c.refresh();
    up = false;
    await new Promise((r) => setTimeout(r, 5));
    await c.refresh();
    expect(c.controlPlaneUnreachable()).toBe(true);
    expect(c.hasPaidPlan()).toBe(true);
  });

  it('treats a server error like an outage', async () => {
    const replies = [new Response(JSON.stringify({ licensed: true, paid: true })), new Response('{}', { status: 503 })];
    const c = client(async () => replies.shift()!, 0);
    await c.refresh();
    await new Promise((r) => setTimeout(r, 5));
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(true);
  });

  it('turns off at once when the control plane itself rejects the key', async () => {
    const replies = [new Response(JSON.stringify({ licensed: true, paid: true })), REJECTED()];
    const c = client(async () => replies.shift()!);
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(true);
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(false);
    expect(c.controlPlaneUnreachable()).toBe(false);
  });

  it.each([
    ['a bare 401', () => new Response('Unauthorized', { status: 401 })],
    ['a 401 with some other JSON', () => new Response(JSON.stringify({ error: 'Bearer token required' }), { status: 401 })],
    ['a 403 from a firewall', () => new Response('<html>Blocked</html>', { status: 403 })],
    ['a 403 with a rejection body', () => new Response(JSON.stringify({ licensed: false, status: 'invalid_key' }), { status: 403 })],
    ['a 200 that is not JSON', () => new Response('<html>Maintenance</html>')],
    ['a 200 that does not mention the plan', () => new Response(JSON.stringify({ licensed: true }))],
  ])('keeps protection on through %s', async (_label, reply) => {
    const replies = [new Response(JSON.stringify({ licensed: true, paid: true })), reply()];
    const c = client(async () => replies.shift()!, 0);
    await c.refresh();
    await new Promise((r) => setTimeout(r, 5));
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(true);
  });

  it('does not read the plan over plain HTTP from another machine', async () => {
    const c = new LicenseClient({
      controlPlaneUrl: 'http://control.example',
      licenseKey: 'gcp_key',
      requireLicense: false,
      refreshSeconds: 300,
      graceSeconds: 900,
      fetchFn: json({ licensed: true, paid: true }) as unknown as typeof fetch,
    });
    await c.refresh();
    expect(c.controlPlaneIsSecure()).toBe(false);
    expect(c.hasPaidPlan()).toBe(false);
  });

  it.each(['http://127.0.0.1:3000', 'http://localhost:3000', 'https://control.example'])('reads the plan from %s', (url) => {
    const c = new LicenseClient({ controlPlaneUrl: url, licenseKey: 'k', requireLicense: false, refreshSeconds: 300, graceSeconds: 900 });
    expect(c.controlPlaneIsSecure()).toBe(true);
  });

  it('stays off after a rejected key, even if an outage follows', async () => {
    const replies: Array<Response | Error> = [
      new Response(JSON.stringify({ licensed: true, paid: true })),
      REJECTED(),
      new Error('offline'),
    ];
    const c = client(async () => {
      const next = replies.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    await c.refresh();
    await c.refresh();
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(false);
  });

  it('reports an unreachable control plane on the first check', async () => {
    const c = client(async () => {
      throw new Error('offline');
    });
    await c.refresh();
    expect(c.hasPaidPlan()).toBe(false);
    expect(c.controlPlaneUnreachable()).toBe(true);
  });
});

describe('loadLicenseClientConfig', () => {
  it('reads the workspace key the Connect page tells people to set', () => {
    vi.stubEnv('MASTYF_AI_LICENSE_KEY', '');
    vi.stubEnv('MASTYF_AI_CLOUD_API_KEY', 'gcp_workspace');
    expect(loadLicenseClientConfig().licenseKey).toBe('gcp_workspace');
  });
});

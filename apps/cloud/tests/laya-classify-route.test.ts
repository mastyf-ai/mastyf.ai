import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveOrgFromApiKey: vi.fn(),
  checkLayaRateLimit: vi.fn(),
  resolveLayaTarget: vi.fn(),
  forwardToLaya: vi.fn(),
  workspaceHasProtocolX: vi.fn(),
  findIssuedEntitlement: vi.fn(),
  sharedTarget: vi.fn(),
}));

vi.mock('@/lib/laya/plan', () => ({ workspaceHasProtocolX: mocks.workspaceHasProtocolX }));
vi.mock('@/lib/org-context', () => ({ resolveOrgFromApiKey: mocks.resolveOrgFromApiKey }));
vi.mock('@/lib/rate-limit', () => ({ checkLayaRateLimit: mocks.checkLayaRateLimit }));
vi.mock('@/lib/laya/deployment', () => ({ resolveLayaTarget: mocks.resolveLayaTarget, sharedTarget: mocks.sharedTarget }));
vi.mock('@/lib/billing/license-keys', () => ({
  findIssuedEntitlement: mocks.findIssuedEntitlement,
  entitlementActive: (e: { status: string }) => e.status === 'active',
}));
vi.mock('@/lib/laya/forward', () => ({ forwardToLaya: mocks.forwardToLaya }));

import { POST, dynamic, preferredRegion, runtime } from '../app/api/v1/laya/classify/route';
import { LAYA_VERDICT_QUESTION } from '../lib/laya/verdict-question';

const KEY = 'gcp_' + 'K'.repeat(43);
const UNKNOWN_KEY = 'gcp_' + 'U'.repeat(43);
const MARKER = 'MARKER-7f3a';
const STATE = `MCP tool call\nTool: read_file\nArguments: {"path": "${MARKER}"}`;
const REMOTE = { kind: 'remote', endpoint: 'https://laya-origin.mastyf.ai/v1/systemone', secret: 'server-secret' };

function validBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ state: STATE, questions: { verdict: LAYA_VERDICT_QUESTION }, ...extra });
}

function call(opts: { key?: string | null; body?: string; url?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
  const key = opts.key === undefined ? KEY : opts.key;
  if (key !== null) headers.authorization = `Bearer ${key}`;
  return POST(
    new Request(opts.url ?? 'https://www.mastyf.ai/api/v1/laya/classify', {
      method: 'POST',
      headers,
      body: opts.body ?? validBody(),
    }),
  );
}

describe('POST /api/v1/laya/classify', () => {
  beforeEach(() => {
    mocks.resolveOrgFromApiKey.mockImplementation(async (token: string) =>
      token === KEY ? { org: { id: 'org-A' }, apiKeyId: 'k1', scopes: ['badge:read', 'laya:classify'] } : null,
    );
    mocks.workspaceHasProtocolX.mockResolvedValue(true);
    mocks.checkLayaRateLimit.mockResolvedValue({ success: true });
    mocks.resolveLayaTarget.mockResolvedValue(REMOTE);
    mocks.forwardToLaya.mockResolvedValue({ ok: true, choice: 'unsafe', confidence: 0.97 });
  });

  describe('license keys from the desktop app', () => {
    const LICENSE = 'MG-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG';

    beforeEach(() => {
      mocks.sharedTarget.mockReturnValue(REMOTE);
    });

    it('gives an active license a verdict from the shared server', async () => {
      mocks.findIssuedEntitlement.mockResolvedValue({ id: 'ent1', status: 'active' });
      const res = await call({ key: LICENSE });
      expect(res.status).toBe(200);
      expect(mocks.findIssuedEntitlement).toHaveBeenCalledWith(LICENSE);
      expect(mocks.checkLayaRateLimit).toHaveBeenCalledWith('license-ent1');
      expect(mocks.resolveOrgFromApiKey).not.toHaveBeenCalled();
    });

    it('401 for a key nobody issued', async () => {
      mocks.findIssuedEntitlement.mockResolvedValue(null);
      expect((await call({ key: LICENSE })).status).toBe(401);
      expect(mocks.forwardToLaya).not.toHaveBeenCalled();
    });

    it('402 for a lapsed license', async () => {
      mocks.findIssuedEntitlement.mockResolvedValue({ id: 'ent1', status: 'expired' });
      expect((await call({ key: LICENSE })).status).toBe(402);
      expect(mocks.forwardToLaya).not.toHaveBeenCalled();
    });

    it('limits each license separately', async () => {
      mocks.findIssuedEntitlement.mockResolvedValue({ id: 'ent1', status: 'active' });
      mocks.checkLayaRateLimit.mockResolvedValue({ success: false, retryAfter: 7 });
      const res = await call({ key: LICENSE });
      expect(res.status).toBe(429);
      expect(mocks.forwardToLaya).not.toHaveBeenCalled();
    });

    it('503, not a verdict, when the lookup fails', async () => {
      mocks.findIssuedEntitlement.mockRejectedValue(new Error('db down'));
      expect((await call({ key: LICENSE })).status).toBe(503);
    });
  });

  describe('paid plan', () => {
    it('402 for a workspace without a paid plan, before anything reaches the model', async () => {
      mocks.workspaceHasProtocolX.mockResolvedValue(false);
      const res = await call();
      expect(res.status).toBe(402);
      expect(await res.json()).toEqual({ error: 'Protocol X requires a paid plan' });
      expect(mocks.workspaceHasProtocolX).toHaveBeenCalledWith('org-A');
      expect(mocks.checkLayaRateLimit).not.toHaveBeenCalled();
      expect(mocks.resolveLayaTarget).not.toHaveBeenCalled();
      expect(mocks.forwardToLaya).not.toHaveBeenCalled();
    });

    it('503, not a verdict, when the plan cannot be read', async () => {
      mocks.workspaceHasProtocolX.mockRejectedValue(new Error('db down'));
      const res = await call();
      expect(res.status).toBe(503);
      expect(mocks.forwardToLaya).not.toHaveBeenCalled();
    });

    it('does not read the plan for a key that lacks the scope', async () => {
      mocks.resolveOrgFromApiKey.mockResolvedValue({ org: { id: 'org-A' }, apiKeyId: 'k1', scopes: ['badge:read'] });
      const res = await call();
      expect(res.status).toBe(403);
      expect(mocks.workspaceHasProtocolX).not.toHaveBeenCalled();
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it('runs on Node in Tokyo, next to the database and the Laya server, never cached', () => {
    expect(runtime).toBe('nodejs');
    expect(preferredRegion).toBe('hnd1');
    expect(dynamic).toBe('force-dynamic');
  });

  it('returns the verdict', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ answers: { verdict: { choice: 'unsafe', answer_confidence: 0.97 } } });
    expect(mocks.forwardToLaya).toHaveBeenCalledWith(
      { endpoint: REMOTE.endpoint, secret: REMOTE.secret },
      STATE,
    );
  });

  it('returns only the verdict', async () => {
    mocks.forwardToLaya.mockResolvedValue({ ok: true, choice: 'safe', confidence: 0.93 });
    const res = await call();
    expect(await res.text()).toBe('{"answers":{"verdict":{"choice":"safe","answer_confidence":0.93}}}');
  });

  describe('401 for any bad key', () => {
    it.each([
      ['no header', null],
      ['a malformed key', 'gcp_bad'],
      ['an unknown key', UNKNOWN_KEY],
    ])('%s', async (_name, key) => {
      const res = await call({ key });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('is uniform', async () => {
      const responses = await Promise.all([call({ key: null }), call({ key: 'gcp_bad' }), call({ key: UNKNOWN_KEY })]);
      const shapes = await Promise.all(
        responses.map(async (r) => ({ status: r.status, body: await r.text(), headers: [...r.headers.entries()] })),
      );
      expect(shapes[1]).toEqual(shapes[0]);
      expect(shapes[2]).toEqual(shapes[0]);
    });

    it('does not look up a malformed key', async () => {
      await call({ key: 'gcp_bad' });
      expect(mocks.resolveOrgFromApiKey).not.toHaveBeenCalled();
    });
  });

  it('403 when the key lacks laya:classify', async () => {
    mocks.resolveOrgFromApiKey.mockResolvedValue({ org: { id: 'org-A' }, apiKeyId: 'k1', scopes: ['badge:read'] });
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('429 with Retry-After when rate limited', async () => {
    mocks.checkLayaRateLimit.mockResolvedValue({ success: false, retryAfter: 42 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(await res.json()).toEqual({ error: 'Rate limit exceeded' });
  });

  it('403 for a self-hosted workspace', async () => {
    mocks.resolveLayaTarget.mockResolvedValue({ kind: 'self_hosted' });
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'This workspace runs Laya on its own infrastructure' });
  });

  it('503 when no target is available', async () => {
    mocks.resolveLayaTarget.mockResolvedValue({ kind: 'unavailable' });
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Laya unavailable' });
  });

  it('400 for a body the validator rejects', async () => {
    const res = await call({ body: JSON.stringify({ state: STATE, questions: { other: {} } }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request' });
  });

  it('503 when the Laya server fails', async () => {
    mocks.forwardToLaya.mockResolvedValue({ ok: false });
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Laya unavailable' });
  });

  it('503, not 500, when a lookup throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resolveLayaTarget.mockRejectedValue(new Error(`db down ${MARKER}`));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Laya unavailable' });
  });

  it('never reaches the model when refused', async () => {
    await call({ key: null });
    await call({ key: UNKNOWN_KEY });
    mocks.resolveOrgFromApiKey.mockResolvedValueOnce({ org: { id: 'org-A' }, apiKeyId: 'k1', scopes: [] });
    await call();
    mocks.checkLayaRateLimit.mockResolvedValueOnce({ success: false, retryAfter: 1 });
    await call();
    mocks.resolveLayaTarget.mockResolvedValueOnce({ kind: 'self_hosted' });
    await call();
    mocks.resolveLayaTarget.mockResolvedValueOnce({ kind: 'unavailable' });
    await call();
    await call({ body: 'not json' });
    expect(mocks.forwardToLaya).not.toHaveBeenCalled();
  });

  it('takes the workspace only from the key', async () => {
    await call({
      url: 'https://www.mastyf.ai/api/v1/laya/classify?orgId=org-B',
      body: validBody({ orgId: 'org-B', tenantId: 'org-B' }),
      headers: { 'X-Org-Id': 'org-B', 'X-Mastyf-Tenant': 'org-B' },
    });
    expect(mocks.checkLayaRateLimit).toHaveBeenCalledWith('org-A');
    expect(mocks.resolveLayaTarget).toHaveBeenCalledWith('org-A');
    expect(mocks.checkLayaRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.resolveLayaTarget).toHaveBeenCalledTimes(1);
  });

  it('never logs the state or the key', async () => {
    const captured: unknown[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        captured.push(...args);
      });
    }
    await call();
    await call({ body: JSON.stringify({ state: STATE }) });
    mocks.forwardToLaya.mockResolvedValueOnce({ ok: false });
    await call();
    mocks.resolveLayaTarget.mockRejectedValueOnce(new Error(`boom ${MARKER} ${KEY}`));
    await call();

    const text = captured.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join('\n');
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain(KEY);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveOrgFromApiKey: vi.fn(), workspaceTier: vi.fn() }));

vi.mock('@/lib/org-context', () => ({ resolveOrgFromApiKey: mocks.resolveOrgFromApiKey }));
vi.mock('@/lib/billing/workspace-tier', () => ({ workspaceTier: mocks.workspaceTier }));

import { GET } from '../app/api/v1/license/route';

const KEY = 'gcp_' + 'K'.repeat(43);
const get = () => GET(new Request('https://www.mastyf.ai/api/v1/license', { headers: { authorization: `Bearer ${KEY}` } }));

describe('GET /api/v1/license plan', () => {
  beforeEach(() => {
    mocks.resolveOrgFromApiKey.mockResolvedValue({ org: { id: 'org-A', slug: 'acme', name: 'Acme' }, apiKeyId: 'k1', scopes: [] });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each(['pro', 'team', 'enterprise'])('reports %s as paid', async (tier) => {
    mocks.workspaceTier.mockResolvedValue(tier);
    const body = await (await get()).json();
    expect(body).toMatchObject({ licensed: true, tier, paid: true });
    expect(mocks.workspaceTier).toHaveBeenCalledWith('org-A');
  });

  it('keeps a free key licensed, but not paid', async () => {
    mocks.workspaceTier.mockResolvedValue('free');
    const body = await (await get()).json();
    expect(body).toMatchObject({ licensed: true, tier: 'free', paid: false });
  });

  it('does not report a paid plan when an unknown tier comes back', async () => {
    mocks.workspaceTier.mockResolvedValue('platinum');
    expect((await (await get()).json()).paid).toBe(false);
  });

  it('rejects an unknown key in the exact form the proxy trusts as a rejection', async () => {
    mocks.resolveOrgFromApiKey.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ licensed: false, status: 'invalid_key' });
  });

  it('answers with an error, not a free or paid plan, when the plan cannot be read', async () => {
    mocks.workspaceTier.mockRejectedValue(new Error('db down'));
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).not.toHaveProperty('paid');
  });
});

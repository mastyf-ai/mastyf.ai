import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ workspaceTier: vi.fn() }));

vi.mock('@/lib/billing/workspace-tier', () => ({ workspaceTier: mocks.workspaceTier }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/org-access', () => ({ resolveOrgAccess: vi.fn() }));

import { workspaceHasProtocolX } from '../lib/laya/plan';

describe('workspaceHasProtocolX', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each(['pro', 'team', 'enterprise'])('allows an active %s plan', async (tier) => {
    mocks.workspaceTier.mockResolvedValue(tier);
    await expect(workspaceHasProtocolX('org-A')).resolves.toBe(true);
    expect(mocks.workspaceTier).toHaveBeenCalledWith('org-A');
  });

  it('refuses the free tier, which is also what an expired or revoked license reads as', async () => {
    mocks.workspaceTier.mockResolvedValue('free');
    await expect(workspaceHasProtocolX('org-A')).resolves.toBe(false);
  });

  it('refuses a tier it does not know', async () => {
    mocks.workspaceTier.mockResolvedValue('platinum');
    await expect(workspaceHasProtocolX('org-A')).resolves.toBe(false);
  });

  it('passes a database failure to the caller rather than allowing the call', async () => {
    mocks.workspaceTier.mockRejectedValue(new Error('db down'));
    await expect(workspaceHasProtocolX('org-A')).rejects.toThrow('db down');
  });
});

describe('/api/v1/license/manage', () => {
  it('is read-only', async () => {
    const route = await import('../app/api/v1/license/manage/route');
    expect(Object.keys(route)).toContain('GET');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(Object.keys(route)).not.toContain(method);
    }
  });
});

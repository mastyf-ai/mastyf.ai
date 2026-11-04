import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));

import { workspaceTier } from '../lib/billing/workspace-tier';

describe('workspaceTier', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('reads the active license', async () => {
    mocks.execute.mockResolvedValue({ rows: [{ tier: 'Team' }] });
    await expect(workspaceTier('org-A')).resolves.toBe('team');
  });

  it('reads no active license as free', async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await expect(workspaceTier('org-A')).resolves.toBe('free');
  });

  it('only counts licenses that are not revoked or expired', async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await workspaceTier('org-A');
    const query = JSON.stringify(mocks.execute.mock.calls[0][0]);
    expect(query).toContain('revoked_at IS NULL');
    expect(query).toContain('expires_at IS NULL OR expires_at > NOW()');
  });

  it('throws on a database failure', async () => {
    mocks.execute.mockRejectedValue(new Error('db down'));
    await expect(workspaceTier('org-A')).rejects.toThrow('db down');
  });
});

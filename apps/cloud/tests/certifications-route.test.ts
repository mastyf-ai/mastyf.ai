import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

const { listPublicCertifications, submitPublicCertification } = vi.hoisted(() => ({
  listPublicCertifications: vi.fn(),
  submitPublicCertification: vi.fn(),
}));

vi.mock('@/lib/industry-standard', () => ({
  listPublicCertifications,
  submitPublicCertification,
}));

vi.mock('@/lib/cloud-observatory-store', () => ({
  queryReputation: () => null,
  upsertReputation: vi.fn(),
}));

vi.mock('@/lib/org-context', () => ({
  resolveOrgFromApiKey: vi.fn(),
}));

import { GET, POST } from '../app/api/v1/certifications/route';

describe('certifications route', () => {
  beforeEach(() => {
    listPublicCertifications.mockReset();
    submitPublicCertification.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DATABASE_URL;
  });

  it('GET returns empty list when DATABASE_URL is unset', async () => {
    const res = await GET(new Request('http://localhost/api/v1/certifications'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      certifications: [],
      count: 0,
      unavailable: true,
      reason: 'database_unconfigured',
    });
    expect(listPublicCertifications).not.toHaveBeenCalled();
  });

  it('POST returns 503 when DATABASE_URL is unset', async () => {
    const res = await POST(
      new Request('http://localhost/api/v1/certifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serverName: 's',
          packageName: '@a/b',
          version: '1.0.0',
          level: 'gold',
          score: 90,
          attestationJws: 'jws',
        }),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'database_unavailable' });
  });

  it('GET lists certifications when database is configured', async () => {
    process.env.DATABASE_URL = 'postgresql://test';
    listPublicCertifications.mockResolvedValue([
      {
        id: 'c1',
        serverName: 'srv',
        packageName: '@a/b',
        version: '1.0.0',
        score: 80,
        level: 'silver',
      },
    ]);
    const res = await GET(new Request('http://localhost/api/v1/certifications'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.certifications[0].serverName).toBe('srv');
  });
});
